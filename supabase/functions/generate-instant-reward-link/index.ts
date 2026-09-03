/**
 * generate-instant-reward-link
 * GET /generate-instant-reward-link
 *   ?shop_domain=&campaign_id=&shopify_order_id=&order_name=&email=
 *
 * Instantly generates (or returns the existing) campaign token for a given
 * order on an instant_reward campaign, and returns the redemption link.
 * No polling required — designed to resolve in ~1 s from the thank-you page.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')             || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const FRONTEND_URL             = Deno.env.get('FRONTEND_URL')             || 'https://app.goself.in';

// Singleton — created once per function instance, reused across all requests
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  // ── CORS preflight ─────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {

    // ── Parse query params ───────────────────────────────────────────────────
    const url           = new URL(req.url);
    const shopDomain    = (url.searchParams.get('shop_domain')      || '').trim();
    const campaignId    = (url.searchParams.get('campaign_id')       || '').trim();
    const shopifyOrderId = (url.searchParams.get('shopify_order_id') || '').trim();
    const orderName     = (url.searchParams.get('order_name')        || '').trim();
    const email         = (url.searchParams.get('email')             || '').trim().toLowerCase();
    const orderTotalRaw = url.searchParams.get('order_total');
    const orderTotal    = orderTotalRaw !== null ? parseFloat(orderTotalRaw) : null;

    if (!shopDomain || !campaignId) {
      return new Response(
        JSON.stringify({ has_rewards: false, reason: 'missing_required_params' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Resolve client_id from store_installations ───────────────────────────
    const { data: installation, error: installErr } = await supabase
      .from('store_installations')
      .select('client_id')
      .eq('shop_domain', shopDomain)
      .maybeSingle();

    if (installErr || !installation) {
      return new Response(
        JSON.stringify({ has_rewards: false, reason: 'store_not_found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clientId: string = installation.client_id;

    // ── Parallel: campaign rule + member lookup (both need client_id) ────────
    const [ruleResult, memberResult] = await Promise.all([
      supabase
        .from('campaign_rules')
        .select('id, name, campaign_id, link_expiry_hours')
        .eq('campaign_id', campaignId)
        .eq('rule_mode', 'instant_reward')
        .eq('is_active', true)
        .eq('client_id', clientId)
        .maybeSingle(),
      email
        ? supabase
            .from('member_users')
            .select('id, full_name')
            .eq('email', email)
            .eq('client_id', clientId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const campaignRule = ruleResult.data;
    if (ruleResult.error || !campaignRule) {
      return new Response(
        JSON.stringify({ has_rewards: false, reason: 'campaign_not_found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const campaignRuleId: string = campaignRule.id;
    const campaignName: string   = campaignRule.name || '';
    const expiryHours: number    = campaignRule.link_expiry_hours ?? 72;

    const member = memberResult.data;
    let memberId: string | null         = member?.id || null;
    let customerFirstName: string | null = member?.full_name
      ? String(member.full_name).split(' ')[0] || null
      : null;

    // ── Determine shopify_order_ref ──────────────────────────────────────────
    // Preference: numeric order ID > order name (e.g. #1234) > email fallback
    const shopifyOrderRef: string =
      shopifyOrderId || orderName || email || 'unknown';

    // ── Idempotent upsert of campaign_tokens ─────────────────────────────────
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

    const tokenInsert: Record<string, unknown> = {
      campaign_rule_id:  campaignRuleId,
      shopify_order_ref: shopifyOrderRef,
      expires_at:        expiresAt,
      is_claimed:        false,
      is_pre_verified:   true,
    };

    if (memberId)  tokenInsert.member_id = memberId;
    if (email)     tokenInsert.email     = email;

    // H-12: ignoreDuplicates:true prevents resetting is_claimed=false on page refresh
    // If the token was already claimed, the existing row is returned unchanged.
    // Note: ignoreDuplicates:true returns zero rows on conflict, so we fall back
    // to an explicit SELECT when the upsert returns nothing.
    const { data: upsertRow, error: upsertErr } = await supabase
      .from('campaign_tokens')
      .upsert(tokenInsert, {
        onConflict:        'campaign_rule_id,shopify_order_ref',
        ignoreDuplicates:  true,
      })
      .select('token, is_claimed')
      .maybeSingle();

    if (upsertErr) {
      console.error('campaign_tokens upsert error:', upsertErr);
      return new Response(
        JSON.stringify({ has_rewards: false, reason: 'token_generation_failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // When a duplicate exists and ignoreDuplicates skips the insert, fetch it explicitly
    let tokenRow = upsertRow;
    if (!tokenRow) {
      const { data: existingRow } = await supabase
        .from('campaign_tokens')
        .select('token, is_claimed')
        .eq('campaign_rule_id', campaignRuleId)
        .eq('shopify_order_ref', shopifyOrderRef)
        .maybeSingle();
      tokenRow = existingRow;
    }

    if (!tokenRow) {
      console.error('campaign_tokens: token not found after upsert');
      return new Response(
        JSON.stringify({ has_rewards: false, reason: 'token_generation_failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token: string          = tokenRow.token;
    const redemptionLink: string = `${FRONTEND_URL}/claim-rewards?token=${token}`;

    // ── Success ──────────────────────────────────────────────────────────────
    // Logging is intentionally omitted here — the shopify-order-webhook fires
    // seconds after checkout and writes the canonical log entry with the proper
    // order name (#1021) and order value. Writing a banner entry here would
    // create a duplicate with only the confirmation token and no order value.
    const responseBody: Record<string, unknown> = {
      has_rewards:     true,
      redemption_link: redemptionLink,
    };

    if (customerFirstName) {
      responseBody.customer_first_name = customerFirstName;
    }

    return new Response(
      JSON.stringify(responseBody),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('generate-instant-reward-link unhandled error:', err);
    return new Response(
      JSON.stringify({ has_rewards: false, reason: 'internal_error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
