import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
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

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const topic = req.headers.get('X-Shopify-Topic') || '';
    const shopDomain = req.headers.get('X-Shopify-Shop-Domain') || '';
    const order = body; // The body is the order object

    if (!topic || !shopDomain || !order) {
      return json({ error: 'Missing topic, shop domain, or order' }, 400);
    }

    // Handle orders/create (check paid) or orders/paid
    const isPaidOrder = (topic === 'orders/paid') || (topic === 'orders/create' && order.financial_status === 'paid');
    if (!isPaidOrder) {
      return json({ message: 'Ignored non-paid order event' });
    }

    const customerEmail = order.customer?.email;
    if (!customerEmail) {
      console.log('[shopify-order-webhook] No customer email in order, order id:', order.id);
      return json({ message: 'No customer email' });
    }

    const normalizedEmail = customerEmail.trim().toLowerCase();

    // DIAGNOSTIC: Log for specific user
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] shopify-order-webhook: Order create paid for user', normalizedEmail, 'order id:', order.id, 'total:', order.total_price, 'financial_status:', order.financial_status);
    }

    // ── Resolve client_id ────────────────────────────────────────────────────
    let clientId: string | null = null;

    const { data: si } = await supabase
      .from('store_installations')
      .select('client_id')
      .eq('shop_domain', shopDomain)
      .eq('installation_status', 'active')
      .maybeSingle();
    if (si) clientId = si.client_id;

    if (!clientId) {
      const { data: ic } = await supabase
        .from('integration_configs')
        .select('client_id')
        .eq('shop_domain', shopDomain)
        .maybeSingle();
      if (ic) clientId = ic.client_id;
    }

    if (!clientId) {
      console.log('[shopify-order-webhook] Shop not found:', shopDomain);
      return json({ error: 'Shop not found or not integrated' }, 404);
    }

    // ── Find or create member ────────────────────────────────────────────────
    let { data: member } = await supabase
      .from('member_users')
      .select('id')
      .eq('email', normalizedEmail)
      .eq('client_id', clientId)
      .maybeSingle();

    if (!member) {
      const { data: fallback } = await supabase
        .from('member_users')
        .select('id')
        .eq('email', normalizedEmail)
        .limit(1)
        .maybeSingle();
      member = fallback;
    }

    // ── AUTO-ENROLL: Create member if not found ──────────────────────────────
    if (!member) {
      const { data: newMember, error: createErr } = await supabase
        .from('member_users')
        .insert({
          email: normalizedEmail,
          client_id: clientId,
          first_name: order.customer?.first_name || null,
          last_name: order.customer?.last_name || null,
          customer_id: order.customer?.id?.toString() || null,
          phone: order.customer?.phone || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (createErr || !newMember) {
        console.error('[shopify-order-webhook] AUTO-ENROLL FAILED: Error creating member:', createErr?.message || 'Unknown error', 'email:', normalizedEmail, 'client_id:', clientId);
        return json({ error: 'Failed to create member for auto-enrollment' }, 500);
      }

      member = newMember;
      console.log('[shopify-order-webhook] AUTO-ENROLLED: Created new member for email:', normalizedEmail, 'member_id:', member.id);
    }

    // DIAGNOSTIC: Log member found
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] shopify-order-webhook: Found member id:', member.id);
    }

    // ── Get or create loyalty status ─────────────────────────────────────────
    let { data: status } = await supabase
      .from('member_loyalty_status')
      .select('id, points_balance, lifetime_points_earned, current_tier_id')
      .eq('member_user_id', member.id)
      .maybeSingle();

    // ── AUTO-ENROLL: Create loyalty status if not found ──────────────────────
    if (!status) {
      // Get loyalty program for this client (REQUIRED - cannot be null)
      const { data: program, error: progError } = await supabase
        .from('loyalty_programs')
        .select('id')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .maybeSingle();

      if (progError) {
        console.error('[shopify-order-webhook] Error fetching program:', progError.message, 'client_id:', clientId);
        return json({ error: 'Failed to find loyalty program for client: ' + progError.message }, 500);
      }

      if (!program?.id) {
        console.error('[shopify-order-webhook] No active loyalty program found for client_id:', clientId);
        return json({ error: 'No active loyalty program configured for this shop' }, 500);
      }

      const programId = program.id;
      let tierId: string | null = null;

      // Get default tier for this program
      const { data: defaultTier } = await supabase
        .from('loyalty_tiers')
        .select('id')
        .eq('loyalty_program_id', programId)
        .eq('is_default', true)
        .maybeSingle();
      
      if (defaultTier?.id) {
        tierId = defaultTier.id;
      } else {
        // If no default tier, get first available tier for this program
        const { data: firstTier } = await supabase
          .from('loyalty_tiers')
          .select('id')
          .eq('loyalty_program_id', programId)
          .limit(1)
          .maybeSingle();
        tierId = firstTier?.id || null;
      }

      if (!tierId) {
        console.error('[shopify-order-webhook] No tier found for program:', programId);
        return json({ error: 'No loyalty tier available for enrollment' }, 500);
      }

      const { data: newStatus, error: enrollErr } = await supabase
        .from('member_loyalty_status')
        .insert({
          member_user_id: member.id,
          loyalty_program_id: programId,
          current_tier_id: tierId,
          points_balance: 0,
          lifetime_points_earned: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id, points_balance, lifetime_points_earned, current_tier_id')
        .single();

      if (enrollErr || !newStatus) {
        console.error('[shopify-order-webhook] AUTO-ENROLL FAILED: Error creating loyalty status:', enrollErr?.message || 'Unknown error', 'member_id:', member.id, 'tier_id:', tierId, 'program_id:', programId);
        return json({ error: 'Failed to enroll in loyalty program: ' + (enrollErr?.message || 'Unknown error') }, 500);
      }

      status = newStatus;
      console.log('[shopify-order-webhook] AUTO-ENROLLED: Created loyalty status for member:', member.id, 'tier_id:', tierId, 'program_id:', programId);
    }

    // DIAGNOSTIC: Log status
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] shopify-order-webhook: Loyalty status found, current balance:', status.points_balance, 'tier id:', status.current_tier_id);
    }

    // ── Get tier for earn rates ──────────────────────────────────────────────
    let earnRate = 1;
    let earnDivisor = 1;

    if (status.current_tier_id) {
      const { data: tier } = await supabase
        .from('loyalty_tiers')
        .select('points_earn_rate, points_earn_divisor')
        .eq('id', status.current_tier_id)
        .maybeSingle();
      if (tier) {
        earnRate = tier.points_earn_rate || 1;
        earnDivisor = tier.points_earn_divisor || 1;
      }
    }

    // ── Calculate points ─────────────────────────────────────────────────────
    const orderTotal = parseFloat(order.total_price || 0);
    const pointsEarned = Math.floor((orderTotal / earnDivisor) * earnRate);

    // DIAGNOSTIC: Log points calc
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] shopify-order-webhook: Calculated points:', pointsEarned, 'total:', orderTotal, 'rate:', earnRate, 'divisor:', earnDivisor);
    }

    if (pointsEarned <= 0) {
      console.log('[shopify-order-webhook] No points to award:', pointsEarned, 'for order:', order.id);
      return json({ message: 'No points to award' });
    }

    // ── Check for duplicate ──────────────────────────────────────────────────
    const { data: existingTxn } = await supabase
      .from('loyalty_points_transactions')
      .select('id')
      .eq('member_user_id', member.id)
      .eq('transaction_type', 'earned')
      .eq('reference_id', order.id.toString())
      .maybeSingle();

    if (existingTxn) {
      console.log('[shopify-order-webhook] Points already awarded for order:', order.id);
      return json({ message: 'Already awarded' });
    }

    // DIAGNOSTIC: Log awarding
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] shopify-order-webhook: Awarding points:', pointsEarned, 'new balance:', newBalance);
    }

    // ── Award points ─────────────────────────────────────────────────────────
    const newBalance = (status.points_balance || 0) + pointsEarned;
    const newLifetime = (status.lifetime_points_earned || 0) + pointsEarned;

    await supabase
      .from('member_loyalty_status')
      .update({
        points_balance: newBalance,
        lifetime_points_earned: newLifetime,
        updated_at: new Date().toISOString(),
      })
      .eq('id', status.id);

    await supabase
      .from('loyalty_points_transactions')
      .insert({
        member_loyalty_status_id: status.id,
        member_user_id: member.id,
        transaction_type: 'earned',
        points_amount: pointsEarned,
        balance_after: newBalance,
        reference_id: order.id.toString(),
        description: `Points earned on order #${order.name || order.id}`,
      });

    // ── Link order to member in shopify_orders table ──────────────────────────
    await supabase
      .from('shopify_orders')
      .update({ member_id: member.id })
      .eq('order_id', order.id.toString())
      .maybeSingle();

    // DIAGNOSTIC: Log points awarded
    if (normalizedEmail === 'groscl.ltd+8809@gmail.com') {
      console.log('[DIAG] shopify-order-webhook: Awarded points:', pointsEarned, 'for order:', order.id, 'new balance:', newBalance);
    }

    return json({ success: true, points_awarded: pointsEarned, order_id: order.id });

  } catch (err) {
    console.error('[shopify-order-webhook] Error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});