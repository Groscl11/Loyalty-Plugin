/**
 * Bulk reprocess orders that exist in shopify_orders but are missing
 * member_id linking, member_loyalty_status, or loyalty_points_transactions.
 *
 * Requires X-Admin-Secret header. POST with JSON body:
 *   { "order_numbers": [1131, 1132, ...] }
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyAdminSecret } from '../_shared/admin-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://goself.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Admin-Secret',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  if (!verifyAdminSecret(req)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json();
  const orderNumbers: number[] = body.order_numbers;

  if (!Array.isArray(orderNumbers) || orderNumbers.length === 0) {
    return json({ error: 'order_numbers array is required' }, 400);
  }

  const results: { order: number; status: string; error?: string }[] = [];

  for (const orderNumber of orderNumbers) {
    try {
      const { data: order, error: orderError } = await supabase
        .from('shopify_orders')
        .select('*')
        .eq('order_number', orderNumber)
        .single();

      if (orderError || !order) {
        results.push({ order: orderNumber, status: 'not_found', error: orderError?.message });
        continue;
      }

      // Find or create member
      let memberId: string | null = null;
      const { data: member } = await supabase
        .from('member_users')
        .select('id')
        .eq('email', order.customer_email)
        .eq('client_id', order.client_id)
        .maybeSingle();

      if (member) {
        memberId = member.id;
      } else {
        const { data: newMember, error: createError } = await supabase
          .from('member_users')
          .insert({
            email: order.customer_email,
            client_id: order.client_id,
            full_name: order.customer_name || 'Guest',
            is_active: true,
          })
          .select('id')
          .single();

        if (createError) {
          results.push({ order: orderNumber, status: 'failed', error: 'member create: ' + createError.message });
          continue;
        }
        memberId = newMember.id;
      }

      // Find or create loyalty status
      const { data: loyaltyProgram, error: programError } = await supabase
        .from('loyalty_programs')
        .select('id')
        .eq('client_id', order.client_id)
        .maybeSingle();

      if (programError || !loyaltyProgram) {
        results.push({ order: orderNumber, status: 'failed', error: 'no loyalty program' });
        continue;
      }

      let loyaltyStatusId: string | null = null;
      const { data: loyaltyStatus } = await supabase
        .from('member_loyalty_status')
        .select('id')
        .eq('member_user_id', memberId)
        .eq('loyalty_program_id', loyaltyProgram.id)
        .maybeSingle();

      if (loyaltyStatus) {
        loyaltyStatusId = loyaltyStatus.id;
      } else {
        const { data: tier, error: tierError } = await supabase
          .from('loyalty_tiers')
          .select('id')
          .eq('loyalty_program_id', loyaltyProgram.id)
          .eq('is_default', true)
          .maybeSingle();

        if (tierError || !tier) {
          results.push({ order: orderNumber, status: 'failed', error: 'no default tier' });
          continue;
        }

        const { data: newStatus, error: createStatusError } = await supabase
          .from('member_loyalty_status')
          .insert({
            member_user_id: memberId,
            loyalty_program_id: loyaltyProgram.id,
            current_tier_id: tier.id,
            points_balance: 0,
            lifetime_points_earned: 0,
          })
          .select('id')
          .single();

        if (createStatusError) {
          results.push({ order: orderNumber, status: 'failed', error: 'status create: ' + createStatusError.message });
          continue;
        }
        loyaltyStatusId = newStatus.id;
      }

      // Get tier earn rates
      const { data: tierData } = await supabase
        .from('loyalty_tiers')
        .select('points_earn_rate, points_earn_divisor')
        .eq('loyalty_program_id', loyaltyProgram.id)
        .eq('is_default', true)
        .maybeSingle();

      const earnRate = tierData?.points_earn_rate || 1;
      const earnDivisor = tierData?.points_earn_divisor || 1;
      const points = Math.floor((order.total_price / earnDivisor) * earnRate);

      // Check for duplicate transaction
      const { data: existingTxn } = await supabase
        .from('loyalty_points_transactions')
        .select('id')
        .eq('member_loyalty_status_id', loyaltyStatusId)
        .eq('reference_id', `shopify_order_${orderNumber}`)
        .maybeSingle();

      if (existingTxn) {
        results.push({ order: orderNumber, status: 'already_processed' });
        continue;
      }

      // Award points
      const { data: currentStatus } = await supabase
        .from('member_loyalty_status')
        .select('points_balance, lifetime_points_earned')
        .eq('id', loyaltyStatusId)
        .single();

      const newBalance = (currentStatus?.points_balance || 0) + points;
      const newLifetime = (currentStatus?.lifetime_points_earned || 0) + points;

      const { error: txnError } = await supabase
        .from('loyalty_points_transactions')
        .insert({
          member_loyalty_status_id: loyaltyStatusId,
          member_user_id: memberId,
          transaction_type: 'earned',
          points_amount: points,
          balance_after: newBalance,
          reference_id: `shopify_order_${orderNumber}`,
          reference_type: 'shopify_order',
        });

      if (txnError) {
        results.push({ order: orderNumber, status: 'failed', error: 'txn create: ' + txnError.message });
        continue;
      }

      await supabase
        .from('member_loyalty_status')
        .update({ points_balance: newBalance, lifetime_points_earned: newLifetime })
        .eq('id', loyaltyStatusId);

      await supabase
        .from('shopify_orders')
        .update({ member_id: memberId })
        .eq('id', order.id);

      results.push({ order: orderNumber, status: 'processed' });

    } catch (err) {
      console.error('[bulk-reprocess-orders] Error on order', orderNumber, ':', (err as Error).message);
      results.push({ order: orderNumber, status: 'error', error: (err as Error).message });
    }
  }

  const summary = {
    total: results.length,
    processed: results.filter(r => r.status === 'processed').length,
    already_processed: results.filter(r => r.status === 'already_processed').length,
    failed: results.filter(r => r.status === 'failed' || r.status === 'error').length,
  };

  return json({ success: true, summary, results });
});
