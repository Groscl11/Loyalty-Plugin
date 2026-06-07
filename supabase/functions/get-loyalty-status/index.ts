import { getWidgetCorsHeaders } from '../_shared/cors.ts';
import { verifyWidgetToken } from '../_shared/widget-auth.ts';

Deno.serve(async (req: Request) => {
  // Widget CORS (reflects storefront origin). Member data is gated by the signed
  // X-Widget-Token, NOT by CORS — see widget-auth.ts.
  const corsHeaders = {
    ...getWidgetCorsHeaders(req.headers.get('origin')),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Widget-Token',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const shopDomain: string | null = body.shop_domain || null;

    // C-01: token is authoritative identity. No token → guest/config-only path.
    const claims = await verifyWidgetToken(req);
    const memberUserId: string | null = claims ? claims.mid : null;
    const clientId: string | null = claims ? claims.cid : (body.client_id || null);

    // ── Guest / program-config-only path ────────────────────────────────────
    if (!memberUserId) {
      if (!shopDomain) {
        return new Response(JSON.stringify({ error: 'shop_domain is required for guest config' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      let guestClientId: string | null = clientId;
      if (!guestClientId) {
        const { data: si } = await supabase.from('store_installations').select('client_id').eq('shop_domain', shopDomain).maybeSingle();
        if (si) guestClientId = si.client_id;
        else {
          const { data: ic } = await supabase.from('integration_configs').select('client_id').eq('shop_domain', shopDomain).maybeSingle();
          if (ic) guestClientId = ic.client_id;
        }
      }

      const guestThresholds: Record<string, number> = {};
      const guestColors: Record<string, string> = {};
      let organizationName: string | null = null;
      // Merchant's auto-enroll preference — the widget reads this to decide whether
      // to silently enroll a logged-in non-member or show a manual join CTA.
      let guestAutoEnroll = false;

      if (guestClientId) {
        const { data: prog } = await supabase
          .from('loyalty_programs')
          .select('id, program_name, auto_enroll_members')
          .eq('client_id', guestClientId).eq('is_active', true).maybeSingle();

        if (prog) {
          const { data: tiers } = await supabase
            .from('loyalty_tiers')
            .select('tier_name, tier_level, min_lifetime_points, color_code')
            .eq('loyalty_program_id', prog.id)
            .order('tier_level', { ascending: true });
          if (tiers) {
            for (const t of tiers) {
              const key = (t.tier_name || '').toLowerCase();
              guestThresholds[key] = t.min_lifetime_points ?? 0;
              if (t.color_code) guestColors[key] = t.color_code;
            }
          }
          organizationName = prog.program_name || null;
          guestAutoEnroll = !!prog.auto_enroll_members;
        }
      }

      return new Response(JSON.stringify({
        guest_config: true,
        organization_name: organizationName,
        auto_enroll: guestAutoEnroll,
        tier_thresholds: Object.keys(guestThresholds).length > 0 ? guestThresholds : undefined,
        tier_colors: Object.keys(guestColors).length > 0 ? guestColors : undefined,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Member data path — requires a valid token ────────────────────────────
    if (!claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized — valid X-Widget-Token required for member data' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let memberUserIdToUse: string = claims.mid;
    let resolvedClientId: string = claims.cid;

    if (shopDomain && !resolvedClientId) {
      const { data: storeInstall } = await supabase.from('store_installations').select('client_id').eq('shop_domain', shopDomain).maybeSingle();
      if (storeInstall) {
        resolvedClientId = storeInstall.client_id;
      } else {
        const { data: integration } = await supabase.from('integration_configs').select('client_id').eq('shop_domain', shopDomain).maybeSingle();
        if (integration) resolvedClientId = integration.client_id;
      }
    }

    let memberFirstName: string | null = null;
    let memberReferralCode: string | null = null;
    const { data: nameRow } = await supabase.from('member_users').select('full_name').eq('id', memberUserIdToUse).maybeSingle();
    memberFirstName = (nameRow?.full_name && String(nameRow.full_name).trim()) ? String(nameRow.full_name).trim().split(/\s+/)[0] : null;

    const { data: statusRows, error: statusError } = await supabase
      .from('member_loyalty_status')
      .select('*, current_tier:loyalty_tiers(*), loyalty_program:loyalty_programs(*)')
      .eq('member_user_id', memberUserIdToUse)
      .order('points_balance', { ascending: false })
      .limit(1);

    const statusData = statusRows?.[0] || null;
    if (statusError || !statusData) {
      return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    memberReferralCode = statusData.referral_code || (memberUserIdToUse ? memberUserIdToUse.replace(/-/g, '').slice(0, 8).toUpperCase() : null);

    const status = statusData;
    const program = status.loyalty_program;
    const tier = status.current_tier;

    const { data: recentTransactions } = await supabase
      .from('loyalty_points_transactions')
      .select('*')
      .eq('member_loyalty_status_id', status.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const tierThresholdsMap: Record<string, number> = {};
    const tierColorsMap: Record<string, string> = {};
    if (program?.id) {
      const { data: allTiers } = await supabase
        .from('loyalty_tiers')
        .select('tier_name, tier_level, min_lifetime_points, color_code')
        .eq('loyalty_program_id', program.id)
        .order('tier_level', { ascending: true });
      if (allTiers) {
        for (const t of allTiers) {
          const key = (t.tier_name || '').toLowerCase();
          tierThresholdsMap[key] = t.min_lifetime_points ?? 0;
          if (t.color_code) tierColorsMap[key] = t.color_code;
        }
      }
    }

    let activeSurvey = null;
    let surveyCompleted = false;
    if (resolvedClientId && memberUserIdToUse) {
      const { data: survey } = await supabase
        .from('loyalty_surveys')
        .select('id, title, questions, points_reward, headline')
        .eq('client_id', resolvedClientId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (survey) {
        activeSurvey = survey;
        const { data: completion } = await supabase.from('survey_completions').select('id').eq('member_user_id', memberUserIdToUse).eq('survey_id', survey.id).maybeSingle();
        surveyCompleted = !!completion;
        if (!surveyCompleted) {
          const { data: response } = await supabase.from('survey_responses').select('id').eq('member_user_id', memberUserIdToUse).eq('survey_id', survey.id).maybeSingle();
          surveyCompleted = !!response;
        }
      }
    }

    return new Response(JSON.stringify({
      member_user_id: memberUserIdToUse,
      client_id: resolvedClientId || null,
      organization_name: program?.program_name || null,
      first_name: memberFirstName,
      referral_code: memberReferralCode,
      points_balance: status.points_balance,
      lifetime_points_earned: status.lifetime_points_earned,
      lifetime_points_redeemed: status.lifetime_points_redeemed,
      total_orders: status.total_orders,
      total_spend: status.total_spend,
      tier: {
        name: tier?.tier_name || 'None',
        level: tier?.tier_level || 0,
        color: tier?.color_code || '#3B82F6',
        benefits: tier?.benefits_description || '',
        points_earn_rate: tier?.points_earn_rate || 1,
        points_earn_divisor: tier?.points_earn_divisor || 1,
        max_redemption_percent: tier?.max_redemption_percent || 100,
      },
      program: {
        name: program.program_name,
        points_name: program.points_name,
        points_name_singular: program.points_name_singular,
        currency: program.currency,
        allow_redemption: program.allow_redemption,
      },
      recent_transactions: recentTransactions || [],
      survey: activeSurvey,
      active_survey: activeSurvey,
      survey_completed: surveyCompleted,
      tier_thresholds: Object.keys(tierThresholdsMap).length > 0 ? tierThresholdsMap : undefined,
      tier_colors: Object.keys(tierColorsMap).length > 0 ? tierColorsMap : undefined,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('Error getting loyalty status:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...getWidgetCorsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } });
  }
});
