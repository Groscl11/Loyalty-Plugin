import { createClient } from 'npm:@supabase/supabase-js@2';
import { issueWidgetToken } from '../_shared/widget-auth.ts';
import { getCorsHeaders } from '../_shared/cors.ts';
// C-01: register-loyalty-member is the ONLY widget endpoint that does not require a
// pre-existing token (the member doesn't have one yet). It issues a fresh token on
// success so all subsequent calls can be authenticated.

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    ...getCorsHeaders(req.headers.get('origin')),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { shop_domain, email, phone, first_name, last_name, full_name, referral_code } = await req.json();

    if (!shop_domain || (!email && !phone)) {
      return json(400, { error: 'shop_domain and (email or phone) are required' });
    }

    // H-01: Validate email format — reject obviously malformed addresses
    const normalizedEmail = email?.trim()?.toLowerCase() || null;
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
      return json(400, { error: 'Invalid email address format' });
    }

    const memberFullName = full_name || `${first_name || ''} ${last_name || ''}`.trim() || 'Member';
    const normalizedPhone = phone?.trim() || null;

    // ── Resolve client — store_installations first (source of truth) ──────
    let clientId: string | null = null;
    const { data: si } = await supabase
      .from('store_installations').select('client_id')
      .eq('shop_domain', shop_domain).eq('installation_status', 'active').maybeSingle();
    if (si) clientId = si.client_id;

    if (!clientId) {
      const { data: ic } = await supabase
        .from('integration_configs').select('client_id')
        .eq('shop_domain', shop_domain).maybeSingle();
      if (ic) clientId = ic.client_id;
    }
    if (!clientId) return json(404, { error: 'Shop not found or not integrated' });

    // H-01: Per-shop registration rate limit — max 30 new members per hour per shop
    // Prevents bulk fake-member farming by counting recent inserts for this client.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from('member_users')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .gte('created_at', oneHourAgo);

    if ((recentCount ?? 0) >= 30) {
      console.warn(`[register-loyalty-member] Rate limit hit for client ${clientId}: ${recentCount} registrations in last hour`);
      return json(429, { error: 'Registration rate limit exceeded — please try again later' });
    }

    // ── Get loyalty program (includes referral_reward_trigger) ──────────────
    const { data: loyaltyProgram, error: programError } = await supabase
      .from('loyalty_programs')
      .select('id, welcome_bonus_points')
      .eq('client_id', clientId).eq('is_active', true).maybeSingle();

    if (programError || !loyaltyProgram) return json(404, { error: 'No active loyalty program found' });

    const referralTrigger: string = 'first_order';

    // ── Fetch signup earning rules (used by the widget’s Ways to Earn tab) ───────
    // These are preferred over loyalty_programs.welcome_bonus_points so that the
    // widget can mark them as “✓ Auto-Earned” after registration.
    const { data: signupRules } = await supabase
      .from('loyalty_earning_rules')
      .select('id, points_reward, name')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .in('rule_type', ['signup', 'welcome_bonus', 'register', 'join']);
    const signupRulePoints: number = (signupRules || []).reduce(
      (sum: number, r: any) => sum + (r.points_reward || 0), 0
    );

    // ── Check if member already exists ─────────────────────────────────────
    let memberQuery = supabase.from('member_users')
      .select('id, email, phone, full_name').eq('client_id', clientId);
    if (normalizedEmail) memberQuery = memberQuery.eq('email', normalizedEmail);
    else memberQuery = memberQuery.eq('phone', normalizedPhone!);
    const { data: existingMember } = await memberQuery.maybeSingle();

    if (existingMember) {
      const { data: existingStatus } = await supabase
        .from('member_loyalty_status')
        .select('id, referred_by_member_id')
        .eq('member_user_id', existingMember.id).maybeSingle();

      if (!existingStatus) {
        // Member exists but no loyalty status — create it
        const { data: tier } = await supabase.from('loyalty_tiers').select('id')
          .eq('loyalty_program_id', loyaltyProgram.id).eq('is_default', true).maybeSingle();
        const wp = signupRulePoints > 0 ? signupRulePoints : (loyaltyProgram.welcome_bonus_points || 0);
        const { data: newStatus } = await supabase.from('member_loyalty_status').insert({
          member_user_id: existingMember.id, loyalty_program_id: loyaltyProgram.id,
          current_tier_id: tier?.id || null, points_balance: wp,
          lifetime_points_earned: wp, lifetime_points_redeemed: 0, total_orders: 0, total_spend: 0,
        }).select().single();
        if (wp > 0 && newStatus) {
          if (signupRules && signupRules.length > 0) {
            for (const rule of (signupRules as any[])) {
              if (rule.points_reward > 0) {
                await supabase.from('loyalty_points_transactions').insert({
                  member_loyalty_status_id: newStatus.id, member_user_id: existingMember.id,
                  transaction_type: 'bonus', points_amount: rule.points_reward, balance_after: wp,
                  description: rule.name || 'Welcome bonus', metadata: { rule_id: rule.id },
                });
              }
            }
          } else {
            await supabase.from('loyalty_points_transactions').insert({
              member_loyalty_status_id: newStatus.id, member_user_id: existingMember.id,
              transaction_type: 'bonus', points_amount: wp, balance_after: wp, description: 'Welcome bonus',
            });
          }
        }
        await linkOrAwardReferral(supabase, existingMember.id, normalizedEmail, normalizedPhone,
          loyaltyProgram.id, clientId, referralTrigger, referral_code, newStatus);
        const enrollToken = await issueWidgetToken(existingMember.id, clientId).catch(() => null);
        return json(200, { success: true, message: 'Member enrolled in loyalty program', member: existingMember, loyalty_status: newStatus, welcome_bonus: wp, widget_token: enrollToken });
      } else {
        // Already has loyalty status — try to link referral if not yet linked
        if (!existingStatus.referred_by_member_id) {
          await linkOrAwardReferral(supabase, existingMember.id, normalizedEmail, normalizedPhone,
            loyaltyProgram.id, clientId, referralTrigger, referral_code, existingStatus);
        }
      }
      const existingToken = await issueWidgetToken(existingMember.id, clientId).catch(() => null);
      return json(200, { success: true, message: 'Member already registered', member: existingMember, widget_token: existingToken });
    }

    // ── New member ──────────────────────────────────────────────────────
    const { data: defaultTier } = await supabase.from('loyalty_tiers').select('id')
      .eq('loyalty_program_id', loyaltyProgram.id).eq('is_default', true).maybeSingle();

    const { data: newMember, error: insertError } = await supabase.from('member_users')
      .insert({ client_id: clientId, email: normalizedEmail, phone: normalizedPhone, full_name: memberFullName, is_active: true })
      .select().single();
    if (insertError) return json(500, { error: 'Failed to register member', details: insertError.message });

    const welcomePoints = signupRulePoints > 0 ? signupRulePoints : (loyaltyProgram.welcome_bonus_points || 0);
    const { data: loyaltyStatus, error: statusError } = await supabase.from('member_loyalty_status').insert({
      member_user_id: newMember.id, loyalty_program_id: loyaltyProgram.id,
      current_tier_id: defaultTier?.id || null, points_balance: welcomePoints,
      lifetime_points_earned: welcomePoints, lifetime_points_redeemed: 0, total_orders: 0, total_spend: 0,
    }).select().single();
    if (statusError) console.error('Failed to create loyalty status:', statusError);

    if (welcomePoints > 0 && loyaltyStatus) {
      if (signupRules && signupRules.length > 0) {
        // Award each signup earning rule with metadata so the widget marks them “✓ Auto-Earned”
        for (const rule of (signupRules as any[])) {
          if (rule.points_reward > 0) {
            await supabase.from('loyalty_points_transactions').insert({
              member_loyalty_status_id: loyaltyStatus.id, member_user_id: newMember.id,
              transaction_type: 'bonus', points_amount: rule.points_reward,
              balance_after: welcomePoints, description: rule.name || 'Welcome bonus',
              metadata: { rule_id: rule.id },
            });
          }
        }
      } else {
        await supabase.from('loyalty_points_transactions').insert({
          member_loyalty_status_id: loyaltyStatus.id, member_user_id: newMember.id,
          transaction_type: 'bonus', points_amount: welcomePoints,
          balance_after: welcomePoints, description: 'Welcome bonus',
        });
      }
    }

    // ── Handle referral based on trigger config ───────────────────────────
    let referralPointsAwarded = 0;
    if (loyaltyStatus) {
      referralPointsAwarded = await linkOrAwardReferral(
        supabase, newMember.id, normalizedEmail, normalizedPhone,
        loyaltyProgram.id, clientId, referralTrigger, referral_code, loyaltyStatus
      );
    }

    // C-01: Issue widget token so the newly registered member can immediately call
    // authenticated endpoints (redeem, claim, etc.) without a second round-trip.
    const widgetToken = await issueWidgetToken(newMember.id, clientId).catch(() => null);

    return json(201, {
      success: true,
      message: 'Member registered successfully',
      member: newMember,
      loyalty_status: loyaltyStatus,
      welcome_bonus: welcomePoints,
      referral_points_awarded: referralPointsAwarded,
      widget_token: widgetToken, // store this and send as X-Widget-Token on subsequent calls
    });

  } catch (error: any) {
    return json(500, { error: error.message });
  }
});

/**
 * Central referral handler called at signup.
 * Behaviour depends on referral_reward_trigger:
 *
 *  'signup'      → award referrer signup points NOW. stamp referred_by. create referral row as
 *                   'signup_rewarded' so complete-referral skips points but still marks completed.
 *  'first_order' → only link referred_by + referral row as 'pending'. NO points now.
 *                   complete-referral awards points later.
 *  'both'        → award referrer signup points NOW + link. complete-referral will award
 *                   the first_order bonus points later (uses points_reward field).
 */
async function linkOrAwardReferral(
  supabase: any,
  memberUserId: string,
  email: string | null,
  phone: string | null,
  loyaltyProgramId: string,
  clientId: string,
  referralTrigger: string,
  referralCodeFromBody: string | null,
  loyaltyStatus: any
): Promise<number> {
  try {
    // Resolve the referrer: code from body takes priority over pending DB referral
    let referrerMemberUserId: string | null = null;
    let referralCode: string | null = null;
    let existingReferralId: string | null = null;

    if (referralCodeFromBody) {
      // Code passed directly at signup via widget
      const { data: rs } = await supabase
        .from('member_loyalty_status')
        .select('member_user_id')
        .eq('referral_code', referralCodeFromBody.toUpperCase())
        .maybeSingle();
      if (rs) {
        referrerMemberUserId = rs.member_user_id;
        referralCode = referralCodeFromBody.toUpperCase();
      }
    }

    if (!referrerMemberUserId) {
      // Check for pending referral created by apply-referral-code earlier
      let q = supabase.from('member_referrals')
        .select('id, referrer_member_id, referral_code')
        .eq('loyalty_program_id', loyaltyProgramId)
        .eq('status', 'pending')
        .is('referred_member_id', null);
      if (phone) q = q.eq('referred_phone', phone);
      else q = q.eq('referred_email', email);
      const { data: pending } = await q.maybeSingle();
      if (pending) {
        referrerMemberUserId = pending.referrer_member_id;
        referralCode = pending.referral_code;
        existingReferralId = pending.id;
      }
    }

    if (!referrerMemberUserId) return 0; // no referrer found

    // H-21: Block self-referral — a member cannot refer themselves
    if (referrerMemberUserId === memberUserId) {
      console.warn('[linkOrAwardReferral] Self-referral blocked for member:', memberUserId);
      return 0;
    }

    // H-21: Block circular referral — check if referrer was referred by this member
    const { data: circularCheck } = await supabase.from('member_referrals').select('id')
      .eq('referrer_member_id', memberUserId).eq('referred_member_id', referrerMemberUserId).maybeSingle();
    if (circularCheck) {
      console.warn('[linkOrAwardReferral] Circular referral blocked between', memberUserId, 'and', referrerMemberUserId);
      return 0;
    }

    // Stamp referred_by_member_id on loyalty status
    if (loyaltyStatus && !loyaltyStatus.referred_by_member_id) {
      await supabase.from('member_loyalty_status')
        .update({ referred_by_member_id: referrerMemberUserId })
        .eq('id', loyaltyStatus.id);
    }

    // Determine if we award points NOW (signup or both) or defer (first_order)
    const awardNow = referralTrigger === 'signup' || referralTrigger === 'both';
    let pointsAwarded = 0;

    if (awardNow) {
      // Get the referral earning rule for this client
      const { data: rule } = await supabase
        .from('loyalty_earning_rules')
        .select('id, referral_signup_points, max_referrals_per_day')
        .eq('client_id', clientId)
        .eq('rule_type', 'referral')
        .eq('is_active', true)
        .limit(1).maybeSingle();

      const signupPoints = rule?.referral_signup_points ?? 0;

      if (signupPoints > 0) {
        // Check daily limit
        let canAward = true;
        if (rule?.max_referrals_per_day) {
          const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
          const { count } = await supabase.from('loyalty_points_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('member_user_id', referrerMemberUserId)
            .ilike('description', 'Referral signup bonus%')
            .gte('created_at', todayStart.toISOString());
          if ((count ?? 0) >= rule.max_referrals_per_day) canAward = false;
        }

        if (canAward) {
          const { data: referrerStatus } = await supabase
            .from('member_loyalty_status')
            .select('id, points_balance, lifetime_points_earned, referral_points_earned')
            .eq('member_user_id', referrerMemberUserId)
            .eq('loyalty_program_id', loyaltyProgramId)
            .maybeSingle();

          if (referrerStatus) {
            const newBalance = (referrerStatus.points_balance ?? 0) + signupPoints;
            await supabase.from('member_loyalty_status').update({
              points_balance: newBalance,
              lifetime_points_earned: (referrerStatus.lifetime_points_earned ?? 0) + signupPoints,
              referral_points_earned: (referrerStatus.referral_points_earned ?? 0) + signupPoints,
              updated_at: new Date().toISOString(),
            }).eq('id', referrerStatus.id);

            await supabase.from('loyalty_points_transactions').insert({
              member_loyalty_status_id: referrerStatus.id,
              member_user_id: referrerMemberUserId,
              transaction_type: 'bonus',
              points_amount: signupPoints,
              balance_after: newBalance,
              description: `Referral signup bonus — friend registered`,
              reference_id: memberUserId,
              metadata: { source: 'referral_signup', referred_member_id: memberUserId, trigger: referralTrigger },
            });

            pointsAwarded = signupPoints;
          }
        }
      }
    }

    // Create or update the referral row
    // Status:
    //   'pending'          → trigger=first_order or both (complete-referral fires later)
    //   'signup_rewarded'  → trigger=signup only (complete-referral skips points, just marks completed)
    const referralStatus = referralTrigger === 'signup' ? 'signup_rewarded' : 'pending';

    if (existingReferralId) {
      // Update existing pending row (from apply-referral-code)
      await supabase.from('member_referrals').update({
        referred_member_id: memberUserId,
        status: referralStatus,
        points_awarded: pointsAwarded,
        ...(referralStatus === 'signup_rewarded' ? { completed_at: new Date().toISOString() } : {}),
      }).eq('id', existingReferralId);
    } else {
      // Create new referral row
      const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + 90);
      await supabase.from('member_referrals').insert({
        loyalty_program_id: loyaltyProgramId,
        referrer_member_id: referrerMemberUserId,
        referred_member_id: memberUserId,
        referral_code: referralCode,
        referred_email: email || null,
        referred_phone: phone || null,
        status: referralStatus,
        points_awarded: pointsAwarded,
        order_completed: false,
        expires_at: expiresAt.toISOString(),
        ...(referralStatus === 'signup_rewarded' ? { completed_at: new Date().toISOString() } : {}),
      });
    }

    return pointsAwarded;
  } catch (err) {
    console.error('linkOrAwardReferral error (non-fatal):', err);
    return 0;
  }
}

function json(status: number, body: object, corsHdrs?: Record<string,string>): Response {
  const headers = corsHdrs
    ? { ...corsHdrs, 'Content-Type': 'application/json' }
    : { 'Access-Control-Allow-Origin': 'https://app.goself.in', 'Content-Type': 'application/json' };
  return new Response(JSON.stringify(body), { status, headers });
}
