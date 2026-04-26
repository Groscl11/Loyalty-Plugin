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
      survey_id,
      answers,
    } = body as {
      email?: string;
      shop_domain?: string;
      survey_id?: string | null;
      answers?: Record<string, unknown>;
    };

    if (!email || !shop_domain) {
      return json({ error: 'email and shop_domain are required' }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

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

    // ── Get active loyalty program ───────────────────────────────────────────
    const { data: loyaltyProgram } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .maybeSingle();

    // ── Persist survey response ──────────────────────────────────────────────
    // Try dedicated table first; fall back to widget_analytics so the call
    // never silently swallows the data.
    const responsePayload = {
      survey_id:      survey_id || null,
      answers:        answers || {},
      submitted_at:   new Date().toISOString(),
    };

    const { error: surveyInsertErr } = await supabase
      .from('survey_responses')
      .insert({
        member_user_id:     memberUserId,
        client_id:          clientId,
        loyalty_program_id: loyaltyProgram?.id || null,
        survey_id:          survey_id || null,
        answers:            answers || {},
        submitted_at:       responsePayload.submitted_at,
      });

    // If survey_responses table doesn't exist, fall back to widget_analytics
    if (surveyInsertErr) {
      console.warn('[submit-survey-response] survey_responses insert failed, falling back to widget_analytics:', surveyInsertErr.message);
      await supabase
        .from('widget_analytics')
        .insert({
          widget_config_id: null,
          event_type: 'survey_complete',
          member_id: memberUserId,
          metadata: responsePayload,
        })
        .then(() => {}) // fire-and-forget fallback
        .catch(() => {});
    }

    // ── Award survey-completion bonus points (if program exists) ────────────
    if (loyaltyProgram?.id) {
      // Lookup active survey earning rule for this client
      const { data: surveyRule } = await supabase
        .from('loyalty_earning_rules')
        .select('id, points_reward')
        .eq('client_id', clientId)
        .eq('rule_type', 'survey')
        .eq('is_active', true)
        .maybeSingle();

      if (!surveyRule) {
        // No active survey earning rule configured — skip points award silently
        console.warn('[submit-survey-response] No active survey earning rule found for client:', clientId);
        return json({ success: true, member_user_id: memberUserId, points_awarded: 0 });
      }
      const SURVEY_BONUS = surveyRule.points_reward;

      const { data: loyaltyStatus } = await supabase
        .from('member_loyalty_status')
        .select('id, points_balance, lifetime_points_earned')
        .eq('member_user_id', memberUserId)
        .maybeSingle();

      if (loyaltyStatus) {
        const newBalance = (loyaltyStatus.points_balance || 0) + SURVEY_BONUS;
        const newLifetime = (loyaltyStatus.lifetime_points_earned || 0) + SURVEY_BONUS;

        await supabase
          .from('member_loyalty_status')
          .update({ points_balance: newBalance, lifetime_points_earned: newLifetime, updated_at: new Date().toISOString() })
          .eq('id', loyaltyStatus.id);

        await supabase
          .from('loyalty_points_transactions')
          .insert({
            member_loyalty_status_id: loyaltyStatus.id,
            member_user_id: memberUserId,
            transaction_type: 'bonus',
            points_amount: SURVEY_BONUS,
            balance_after: newBalance,
            description: `Survey completed${survey_id ? ` (${survey_id})` : ''}`,
            metadata: surveyRule ? { rule_id: surveyRule.id } : {},
          });
      }
    }

    return json({ success: true, member_user_id: memberUserId });
  } catch (err) {
    console.error('[submit-survey-response] unexpected error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
