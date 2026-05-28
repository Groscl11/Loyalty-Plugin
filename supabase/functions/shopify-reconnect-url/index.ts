/**
 * shopify-reconnect-url
 *
 * Generates the Shopify OAuth authorize URL for reconnecting (or re-installing)
 * a store. This is used when the stored access token has expired and the merchant
 * needs to re-authorize the app.
 *
 * Importantly: the authorize URL is built WITHOUT grant_options[]=per-user, so
 * Shopify issues an offline permanent access token (shpat_) rather than an
 * expiring online token (shpua_).
 *
 * Query params:
 *   - shop_domain  (required) e.g. "mystore.myshopify.com"
 *   - client_id    (optional) the Goself client UUID — passed through state for callback
 *   - app_url      (optional) dashboard origin to redirect to after auth
 *
 * Returns: { auth_url: string }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

  try {
    const url        = new URL(req.url);
    const shopDomain = url.searchParams.get('shop_domain') || '';
    const clientId   = url.searchParams.get('client_id')   || '';
    const appUrl     = url.searchParams.get('app_url')     || Deno.env.get('DASHBOARD_URL') || 'https://dev.app.goself.in';

    if (!shopDomain || !/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shopDomain)) {
      return json({ error: 'Invalid or missing shop_domain' }, 400);
    }

    const SHOPIFY_KEY   = Deno.env.get('SHOPIFY_API_KEY')    || '';
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')       || '';
    const callbackUrl   = `${SUPABASE_URL}/functions/v1/shopify-oauth-callback`;

    if (!SHOPIFY_KEY) return json({ error: 'Server misconfiguration' }, 500);

    // SCOPES — must match shopify.app.*.toml scopes exactly
    const scopes = 'read_customers,read_orders,read_discounts,write_discounts,read_price_rules,write_price_rules';

    // State encodes the app URL (for safe redirect after auth) and optional client_id
    const state = encodeURIComponent(btoa(JSON.stringify({
      app_url:   appUrl,
      client_id: clientId || undefined,
      ts:        Date.now(),
    })));

    // Build the authorize URL WITHOUT grant_options[]=per-user
    // → Shopify will issue an offline permanent access token (shpat_)
    const authUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
    authUrl.searchParams.set('client_id',    SHOPIFY_KEY);
    authUrl.searchParams.set('scope',        scopes);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('state',        state);

    console.log(`[shopify-reconnect-url] Generated auth URL for ${shopDomain}`);
    return json({ auth_url: authUrl.toString() });

  } catch (err: any) {
    console.error('[shopify-reconnect-url] error:', err.message);
    return json({ error: err.message }, 500);
  }
});
