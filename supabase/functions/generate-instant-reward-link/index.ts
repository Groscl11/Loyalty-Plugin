/**
 * generate-instant-reward-link
 * GET /generate-instant-reward-link
 *   ?shop_domain=&campaign_id=&shopify_order_id=&order_name=&email=
 *
 * Instantly generates (or returns the existing) campaign token for a given
 * order on an instant_reward campaign, and returns the redemption link.
 * No polling required — designed to resolve in ~1 s from the thank-you page.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')             || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const FRONTEND_URL             = Deno.env.get('FRONTEND_URL')             || 'https://dev.app.goself.in';

Deno.serve(async (req: Request) => {
  // ── CORS preflight ─────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Parse query params ───────────────────────────────────────────────────
    const url           = new URL(req.url);
    const shopDomain    = (url.searchParams.get('shop_domain')      || '').trim();
    const campaignId    = (url.searchParams.get('campaign_id')       || '').trim();
    const shopifyOrderId = (url.searchParams.get('shopify_order_id') || '').trim();
    const orderName     = (url.searchParams.get('order_name')        || '').trim();
    const email         = (url.searchParams.get('email')             || '').trim().toLowerCase();

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

    // ── Find matching instant_reward campaign rule ────────────────────────────
    const { data: campaignRule, error: ruleErr } = await supabase
      .from('campaign_rules')
      .select('id, link_expiry_hours')
      .eq('campaign_id', campaignId)
      .eq('rule_mode', 'instant_reward')
      .eq('is_active', true)
      .eq('client_id', clientId)
      .maybeSingle();

    if (ruleErr || !campaignRule) {
      return new Response(
        JSON.stringify({ has_rewards: false, reason: 'campaign_not_found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const campaignRuleId: string = campaignRule.id;
    const expiryHours: number    = campaignRule.link_expiry_hours ?? 72;

    // ── Resolve member_id and customer name (optional, by email) ─────────────
    let memberId: string | null        = null;
    let customerFirstName: string | null = null;

    if (email) {
      const { data: member } = await supabase
        .from('members')
        .select('id, first_name')
        .eq('email', email)
        .eq('client_id', clientId)
        .maybeSingle();

      if (member) {
        memberId          = member.id     || null;
        customerFirstName = member.first_name || null;
      }
    }

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

    const { data: tokenRow, error: upsertErr } = await supabase
      .from('campaign_tokens')
      .upsert(tokenInsert, {
        onConflict:        'campaign_rule_id,shopify_order_ref',
        ignoreDuplicates:  false,
      })
      .select('token')
      .single();

    if (upsertErr || !tokenRow) {
      console.error('campaign_tokens upsert error:', upsertErr);
      return new Response(
        JSON.stringify({ has_rewards: false, reason: 'token_generation_failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token: string          = tokenRow.token;
    const redemptionLink: string = `${FRONTEND_URL}/claim-rewards?token=${token}`;

    // ── Success ──────────────────────────────────────────────────────────────
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
