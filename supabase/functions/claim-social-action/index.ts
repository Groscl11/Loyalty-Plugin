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
    const {
      email,
      shop_domain,
      rule_id,
    } = body as {
      email?: string;
      shop_domain?: string;
      rule_id?: string;
    };

    if (!email || !shop_domain || !rule_id) {
      return json({ error: 'email, shop_domain, and rule_id are required' }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    console.log('[claim-social-action] Starting claim for user:', normalizedEmail, 'rule_id:', rule_id);

    // ── Resolve client_id ────────────────────────────────────────────────────
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

    if (!clientId) {
      return json({ error: 'Shop not found or not integrated', shop_domain }, 404);
    }

    // ── Resolve member ───────────────────────────────────────────────────────
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

    if (!member) {
      return json({ error: 'Member not found' }, 404);
    }

    const memberUserId = member.id;

    console.log('[claim-social-action] Found member:', memberUserId);

    // ── Lookup earning rule ──────────────────────────────────────────────────
    const { data: rule } = await supabase
      .from('loyalty_earning_rules')
      .select('id, points_reward, rule_type, name, social_platform')
      .eq('id', rule_id)
      .eq('is_active', true)
      .maybeSingle();

    if (!rule) {
      return json({ error: 'Earning rule not found or inactive' }, 404);
    }

    if (rule.rule_type !== 'social') {
      return json({ error: 'Rule is not a social action rule' }, 400);
    }

    console.log('[claim-social-action] Found rule:', rule.id, 'platform:', rule.social_platform, 'points:', rule.points_reward);

    // ── Check if already claimed (prevent double-claiming) ────────────────────
    const { data: existingTxn } = await supabase
      .from('loyalty_points_transactions')
      .select('id')
      .eq('member_user_id', memberUserId)
      .eq('transaction_type', 'bonus')
      .contains('metadata', JSON.stringify({ rule_id: rule.id }))
      .limit(1)
      .maybeSingle();

    if (existingTxn) {
      console.log('[claim-social-action] Already claimed by member:', memberUserId, 'rule:', rule.id);
      return json({ error: 'Action already claimed', already_claimed: true }, 400);
    }

    // ── Get or create loyalty enrollment ─────────────────────────────────────
    let { data: loyaltyStatus } = await supabase
      .from('member_loyalty_status')
      .select('id, points_balance, lifetime_points_earned, current_tier_id')
      .eq('member_user_id', memberUserId)
      .maybeSingle();

    if (!loyaltyStatus) {
      console.log('[claim-social-action] Member not enrolled, auto-enrolling...');
      
      // Get default tier
      const { data: defaultTier } = await supabase
        .from('loyalty_tiers')
        .select('id')
        .eq('is_default', true)
        .limit(1)
        .maybeSingle();

      const tierId = defaultTier?.id || null;

      const { data: newStatus, error: enrollErr } = await supabase
        .from('member_loyalty_status')
        .insert({
          member_user_id: memberUserId,
          loyalty_program_id: null,
          current_tier_id: tierId,
          points_balance: 0,
          lifetime_points_earned: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id, points_balance, lifetime_points_earned, current_tier_id')
        .single();

      if (enrollErr || !newStatus) {
        console.error('[claim-social-action] Failed to create enrollment:', enrollErr?.message);
        return json({ error: 'Failed to create enrollment' }, 500);
      }

      loyaltyStatus = newStatus;
    }

    // ── Award points ─────────────────────────────────────────────────────────
    const SOCIAL_BONUS = rule.points_reward || 100; // Fallback to 100 if not set

    const newBalance = (loyaltyStatus.points_balance || 0) + SOCIAL_BONUS;
    const newLifetime = (loyaltyStatus.lifetime_points_earned || 0) + SOCIAL_BONUS;

    const { error: updateErr } = await supabase
      .from('member_loyalty_status')
      .update({
        points_balance: newBalance,
        lifetime_points_earned: newLifetime,
        updated_at: new Date().toISOString(),
      })
      .eq('id', loyaltyStatus.id);

    if (updateErr) {
      console.error('[claim-social-action] Failed to update points:', updateErr.message);
      return json({ error: 'Failed to update points balance' }, 500);
    }

    // ── Create transaction record ────────────────────────────────────────────
    const { data: txn, error: txnErr } = await supabase
      .from('loyalty_points_transactions')
      .insert({
        member_loyalty_status_id: loyaltyStatus.id,
        member_user_id: memberUserId,
        transaction_type: 'bonus',
        points_amount: SOCIAL_BONUS,
        balance_after: newBalance,
        description: `${rule.social_platform || 'Social'} action: ${rule.name || 'Follow'}`,
        reference_type: 'earning_rule',
        reference_id: rule.id,
        metadata: { rule_id: rule.id, social_platform: rule.social_platform },
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (txnErr) {
      console.error('[claim-social-action] Failed to create transaction:', txnErr.message);
      return json({ error: 'Failed to create transaction' }, 500);
    }

    console.log('[claim-social-action] SUCCESS: Awarded', SOCIAL_BONUS, 'points to member:', memberUserId);

    return json({
      success: true,
      member_user_id: memberUserId,
      rule_id: rule.id,
      points_awarded: SOCIAL_BONUS,
      new_balance: newBalance,
      transaction_id: txn.id,
    });
  } catch (err) {
    console.error('[claim-social-action] unexpected error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
