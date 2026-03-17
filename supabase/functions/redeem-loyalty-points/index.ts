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
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'POST required' }, 405);
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const { member_user_id, email, shop_domain, reward_id, points } = body;

    if (!shop_domain || (!member_user_id && !email) || !reward_id || points === undefined) {
      return json(
        { error: 'shop_domain, (member_user_id or email), reward_id, and points are required' },
        400
      );
    }

    const pointsValue = Number(points);
    if (isNaN(pointsValue) || pointsValue <= 0) {
      return json({ error: 'points must be a positive number' }, 400);
    }

    // ── Resolve member ───────────────────────────────────────────────────────
    let memberId = member_user_id;

    if (!memberId && email) {
      const { data: memberData } = await supabase
        .from('member_users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (!memberData) {
        return json({ error: 'Member not found' }, 404);
      }

      memberId = memberData.id;
    }

    if (!memberId) {
      return json({ error: 'Member not found' }, 404);
    }

    // ── Get client_id via shop_domain ────────────────────────────────────────
    let clientId: string | null = null;

    const { data: storeInstall } = await supabase
      .from('store_installations')
      .select('client_id')
      .eq('shop_domain', shop_domain)
      .maybeSingle();

    if (storeInstall) {
      clientId = storeInstall.client_id;
    } else {
      const { data: integration } = await supabase
        .from('integration_configs')
        .select('client_id')
        .eq('shop_domain', shop_domain)
        .maybeSingle();
      if (integration) {
        clientId = integration.client_id;
      }
    }

    if (!clientId) {
      return json({ error: 'Shop not found or not integrated' }, 404);
    }

    // ── Get loyalty status ───────────────────────────────────────────────────
    const { data: loyaltyStatus, error: statusError } = await supabase
      .from('member_loyalty_status')
      .select('*, current_tier:loyalty_tiers(*), loyalty_program:loyalty_programs(*)')
      .eq('member_user_id', memberId)
      .maybeSingle();

    if (!loyaltyStatus) {
      return json({ error: 'Member not enrolled in loyalty program' }, 404);
    }

    // ── Check program allows redemption ──────────────────────────────────────
    const program = loyaltyStatus.loyalty_program;
    if (!program?.allow_redemption) {
      return json({ error: 'Redemption is not enabled for this loyalty program' }, 400);
    }

    // ── Check sufficient points ──────────────────────────────────────────────
    const currentBalance = loyaltyStatus.points_balance || 0;
    if (currentBalance < pointsValue) {
      return json(
        {
          error: 'Insufficient points',
          current_points: currentBalance,
          required_points: pointsValue,
        },
        400
      );
    }


    // ── Get reward details ───────────────────────────────────────────────────
    const { data: reward, error: rewardError } = await supabase
      .from('loyalty_rewards')
      .select('*')
      .eq('id', reward_id)
      .eq('loyalty_program_id', loyaltyStatus.loyalty_program_id)
      .maybeSingle();

    if (!reward) {
      return json({ error: 'Reward not found' }, 404);
    }

    if (!reward.is_active) {
      return json({ error: 'This reward is no longer available' }, 400);
    }

    // ── Prevent multiple claims of the same partner coupon ───────────────────
    // Only for partner-type rewards (customize as needed)
    if (reward.reward_type === 'partner_coupon') {
      const { data: existingRedemption } = await supabase
        .from('loyalty_reward_redemptions')
        .select('id')
        .eq('member_loyalty_status_id', loyaltyStatus.id)
        .eq('loyalty_reward_id', reward_id)
        .eq('redemption_status', 'active')
        .maybeSingle();
      if (existingRedemption) {
        return json({ error: 'You have already claimed this partner coupon.' }, 400);
      }
    }

    // ── Generate discount code ───────────────────────────────────────────────
    const discountCode = `REDEEM${Date.now().toString(36).toUpperCase()}`;

    // ── Create transaction ───────────────────────────────────────────────────
    const newBalance = currentBalance - pointsValue;
    const redeemed = (loyaltyStatus.lifetime_points_redeemed || 0) + pointsValue;

    const { data: transaction, error: txnError } = await supabase
      .from('loyalty_points_transactions')
      .insert({
        member_loyalty_status_id: loyaltyStatus.id,
        member_user_id: memberId,
        transaction_type: 'redeemed',
        points_amount: -pointsValue,
        balance_after: newBalance,
        reference_id: reward_id,
        description: `Redeemed: ${reward.reward_name}`,
        order_id: null,
      })
      .select('id')
      .single();

    if (txnError || !transaction) {
      return json({ error: 'Failed to create redemption transaction' }, 500);
    }

    // ── Update loyalty status ────────────────────────────────────────────────
    const { error: updateError } = await supabase
      .from('member_loyalty_status')
      .update({
        points_balance: newBalance,
        lifetime_points_redeemed: redeemed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', loyaltyStatus.id);

    if (updateError) {
      return json({ error: 'Failed to update loyalty status' }, 500);
    }

    // ── Create reward redemption record ──────────────────────────────────────
    const { error: redemptionError } = await supabase
      .from('loyalty_reward_redemptions')
      .insert({
        member_loyalty_status_id: loyaltyStatus.id,
        loyalty_reward_id: reward_id,
        discount_code: discountCode,
        points_redeemed: pointsValue,
        redemption_status: 'active',
        created_at: new Date().toISOString(),
      });

    if (redemptionError) {
      console.warn('Warning: Failed to create redemption record:', redemptionError);
      // Don't fail the whole operation if we can't create the record
    }

    console.log('[redeem-loyalty-points] Redeemed:', {
      member_user_id: memberId,
      reward_id,
      points_redeemed: pointsValue,
      new_balance: newBalance,
      discount_code: discountCode,
    });

    return json({
      success: true,
      discount_code: discountCode,
      points_redeemed: pointsValue,
      new_balance: newBalance,
      reward_name: reward.reward_name,
    });
  } catch (err) {
    console.error('[redeem-loyalty-points] Error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
