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
    // distribution_id (offer_distributions.id) is preferred; reward_id (rewards.id) is fallback
    // NOTE: points are NOT accepted from the caller ΓÇö they are read from offer_distributions.points_cost
    const { member_user_id, email, shop_domain, reward_id, distribution_id } = body;

    if (!shop_domain || (!member_user_id && !email) || !reward_id) {
      return json({ error: 'shop_domain, (member_user_id or email), and reward_id are required' }, 400);
    }

    // ΓöÇΓöÇ Resolve client_id ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    let clientId: string | null = null;

    const { data: si } = await supabase
      .from('store_installations')
      .select('client_id')
      .eq('shop_domain', shop_domain)
      .eq('installation_status', 'active')
      .maybeSingle();
    if (si) clientId = si.client_id;

    if (!clientId) {
      const { data: ic } = await supabase
        .from('integration_configs')
        .select('client_id')
        .eq('shop_domain', shop_domain)
        .maybeSingle();
      if (ic) clientId = ic.client_id;
    }

    if (!clientId) return json({ error: 'Shop not found or not integrated' }, 404);

    // ΓöÇΓöÇ Resolve member ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    let memberId = member_user_id ?? null;

    if (!memberId && email) {
      const normalizedEmail = (email as string).trim().toLowerCase();

      const { data: m } = await supabase
        .from('member_users')
        .select('id')
        .eq('email', normalizedEmail)
        .eq('client_id', clientId)
        .maybeSingle();

      if (m) {
        memberId = m.id;
      } else {
        const { data: fallback } = await supabase
          .from('member_users')
          .select('id')
          .eq('email', normalizedEmail)
          .limit(1)
          .maybeSingle();
        if (fallback) memberId = fallback.id;
      }
    }

    if (!memberId) return json({ error: 'Member not found' }, 404);

    // ΓöÇΓöÇ Get loyalty status ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const { data: loyaltyStatus } = await supabase
      .from('member_loyalty_status')
      .select('id, points_balance, lifetime_points_redeemed, loyalty_program:loyalty_programs(allow_redemption)')
      .eq('member_user_id', memberId)
      .order('points_balance', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!loyaltyStatus) return json({ error: 'Member not enrolled in loyalty program' }, 404);

    const program = (loyaltyStatus as any).loyalty_program;
    if (program && program.allow_redemption === false) {
      return json({ error: 'Redemption is not enabled for this loyalty program' }, 400);
    }

    // ΓöÇΓöÇ Find offer distribution ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // points_cost is always read from offer_distributions ΓÇö never from request body
    let distQuery = supabase
      .from('offer_distributions')
      .select(`
        id,
        points_cost,
        max_per_member,
        offer:rewards(
          id, title, offer_type, coupon_type, generic_coupon_code, available_codes, status, is_active
        )
      `)
      .eq('distributing_client_id', clientId)
      .eq('is_active', true);

    if (distribution_id) {
      distQuery = distQuery.eq('id', distribution_id);
    } else {
      distQuery = distQuery.eq('offer_id', reward_id);
    }

    const { data: distribution } = await distQuery.maybeSingle();

    if (!distribution || !(distribution as any).offer) {
      return json({ error: 'Reward not found or not available for this shop' }, 404);
    }

    const offer = (distribution as any).offer;

    if (!offer.is_active || offer.status !== 'active') {
      return json({ error: 'This reward is no longer available' }, 400);
    }

    // ΓöÇΓöÇ Read authoritative points cost from offer_distributions ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const pointsCost: number = (distribution as any).points_cost ?? 0;
    if (pointsCost <= 0) {
      return json({ error: 'Invalid points cost configured for this reward' }, 400);
    }

    const currentBalance = (loyaltyStatus as any).points_balance || 0;
    if (currentBalance < pointsCost) {
      return json({
        error: 'Insufficient points',
        current_points: currentBalance,
        required_points: pointsCost,
      }, 400);
    }

    // ΓöÇΓöÇ Enforce max_per_member ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const maxPerMember = (distribution as any).max_per_member;
    if (maxPerMember) {
      const { count } = await supabase
        .from('loyalty_points_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('member_user_id', memberId)
        .eq('transaction_type', 'redeemed')
        .eq('reference_id', offer.id);

      if ((count ?? 0) >= maxPerMember) {
        return json({ error: 'You have already claimed this reward the maximum number of times.' }, 400);
      }
    }

    // ΓöÇΓöÇ Acquire discount code ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    let code: string | null = null;

    if (offer.coupon_type === 'generic') {
      // Generic coupon ΓÇö single shared code, no inventory deduction
      code = offer.generic_coupon_code ?? null;
    } else {
      // Unique code ΓÇö pull one available record from offer_codes
      const { data: codeRow } = await supabase
        .from('offer_codes')
        .select('id, code')
        .eq('offer_id', offer.id)
        .eq('status', 'available')
        .is('assigned_to_member_id', null)
        .limit(1)
        .maybeSingle();

      if (!codeRow) {
        return json({ error: 'No codes available for this reward at this time' }, 400);
      }

      // Assign the code to this member atomically
      const { error: assignErr } = await supabase
        .from('offer_codes')
        .update({
          status: 'assigned',
          assigned_to_member_id: memberId,
          assigned_at: new Date().toISOString(),
        })
        .eq('id', (codeRow as any).id)
        .eq('status', 'available'); // guard against race condition

      if (assignErr) {
        console.error('[redeem-loyalty-points] Code assignment failed:', assignErr.message);
        return json({ error: 'Failed to assign code ΓÇö please try again' }, 500);
      }

      // Decrement available_codes counter on rewards
      if ((offer.available_codes ?? 0) > 0) {
        await supabase
          .from('rewards')
          .update({ available_codes: offer.available_codes - 1 })
          .eq('id', offer.id);
      }

      code = (codeRow as any).code;
    }

    // ΓöÇΓöÇ Deduct points ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const newBalance = currentBalance - pointsCost;
    const newRedeemed = ((loyaltyStatus as any).lifetime_points_redeemed || 0) + pointsCost;

    const { error: updateErr } = await supabase
      .from('member_loyalty_status')
      .update({
        points_balance: newBalance,
        lifetime_points_redeemed: newRedeemed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', (loyaltyStatus as any).id);

    if (updateErr) {
      console.error('[redeem-loyalty-points] Balance update failed:', updateErr.message);
      return json({ error: 'Failed to update points balance' }, 500);
    }

    // ΓöÇΓöÇ Record transaction ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const { error: txnErr } = await supabase
      .from('loyalty_points_transactions')
      .insert({
        member_loyalty_status_id: (loyaltyStatus as any).id,
        member_user_id: memberId,
        transaction_type: 'redeemed',
        points_amount: -pointsCost,
        balance_after: newBalance,
        reference_id: offer.id,
        description: `Redeemed: ${offer.title}`,
        metadata: {
          distribution_id: (distribution as any).id,
          offer_type: offer.offer_type,
          code,
        },
      });

    if (txnErr) {
      console.error('[redeem-loyalty-points] Transaction insert failed:', txnErr.message);
      // Points already deducted ΓÇö log but don't fail the response
    }

    console.log('[redeem-loyalty-points] Success:', {
      member_user_id: memberId,
      offer_id: offer.id,
      distribution_id: (distribution as any).id,
      points_cost: pointsCost,
      new_balance: newBalance,
    });

    return json({
      success: true,
      discount_code: code,
      code,
      points_redeemed: pointsCost,
      new_balance: newBalance,
      reward_name: offer.title,
    });

  } catch (err) {
    console.error('[redeem-loyalty-points] Error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
