import { getCorsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'POST required' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const memberUserId: string | null = body.member_user_id || null;
    const email: string | null = body.email || body.customer_email || null;
    const shopDomain: string | null = body.shop_domain || null;
    const clientId: string | null = body.client_id || null;

    if (!memberUserId && !email) {
      return new Response(
        JSON.stringify({ error: 'Either member_user_id or email (or customer_email) is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let memberUserIdToUse = memberUserId;
    let resolvedClientId = clientId;

    // If shop_domain is provided, find the client_id
    // store_installations is the primary source of truth
    if (shopDomain && !resolvedClientId) {
      const { data: storeInstall } = await supabase
        .from('store_installations')
        .select('client_id')
        .eq('shop_domain', shopDomain)
        .maybeSingle();

      if (storeInstall) {
        resolvedClientId = storeInstall.client_id;
      } else {
        const { data: integration } = await supabase
          .from('integration_configs')
          .select('client_id')
          .eq('shop_domain', shopDomain)
          .maybeSingle();

        if (integration) {
          resolvedClientId = integration.client_id;
        }
      }
    }

    // If we have email but not member_user_id, look up the member
    let memberReferralCode: string | null = null;
    if (!memberUserIdToUse && email) {
      let query = supabase
        .from('member_users')
        .select('*')
        .eq('email', email);

      if (resolvedClientId) {
        query = query.eq('client_id', resolvedClientId);
      }

      let { data: memberData } = await query.maybeSingle();

      // If not found with client filter (or no client resolved), try email-only fallback
      if (!memberData) {
        const { data: fallbackMembers } = await supabase
          .from('member_users')
          .select('*')
          .eq('email', email)
          .limit(10);
        if (fallbackMembers && fallbackMembers.length === 1) {
          memberData = fallbackMembers[0];
        } else if (fallbackMembers && fallbackMembers.length > 1) {
          // Multiple members with same email across clients — pick the one with an active loyalty status
          for (const candidate of fallbackMembers) {
            const { data: hasStatus } = await supabase
              .from('member_loyalty_status')
              .select('id')
              .eq('member_user_id', candidate.id)
              .maybeSingle();
            if (hasStatus) { memberData = candidate; break; }
          }
        }
      }

      if (!memberData) {
        return new Response(
          JSON.stringify({ error: 'Member not found' }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      memberUserIdToUse = memberData.id;
      // Resolve client_id from member record if not already resolved via shop_domain
      if (!resolvedClientId && memberData.client_id) {
        resolvedClientId = memberData.client_id;
      }
      // Don't set referral_code here — member_loyalty_status.referral_code is the source of truth
    }

    const { data: statusRows, error: statusError } = await supabase
      .from('member_loyalty_status')
      .select('*, current_tier:loyalty_tiers(*), loyalty_program:loyalty_programs(*)')
      .eq('member_user_id', memberUserIdToUse)
      .order('points_balance', { ascending: false })
      .limit(1);

    const statusData = statusRows?.[0] || null;

    if (statusError || !statusData) {
      return new Response(
        JSON.stringify({ error: 'Member not enrolled in loyalty program' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Use member_loyalty_status.referral_code as source of truth; fall back to UUID-derived code
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

    // Fetch active survey for this client
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

        const { data: completion } = await supabase
          .from('survey_completions')
          .select('id')
          .eq('member_user_id', memberUserIdToUse)
          .eq('survey_id', survey.id)
          .maybeSingle();
        surveyCompleted = !!completion;

        if (!surveyCompleted) {
          const { data: response } = await supabase
            .from('survey_responses')
            .select('id')
            .eq('member_user_id', memberUserIdToUse)
            .eq('survey_id', survey.id)
            .maybeSingle();
          surveyCompleted = !!response;
        }
      }
    }

    return new Response(
      JSON.stringify({
        member_user_id: memberUserIdToUse,
        client_id: resolvedClientId || null,
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
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error getting loyalty status:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
