/**
 * shopify-reconnect-url
 *
 * H-19: Generates a cryptographic nonce, stores it in oauth_nonces (TTL 10 min),
 * and includes it in the state parameter. shopify-oauth-callback validates the
 * nonce to prevent CSRF on the install flow.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const url        = new URL(req.url);
    const shopDomain = url.searchParams.get('shop_domain') || '';
    const clientId   = url.searchParams.get('client_id')   || '';
    const appUrl     = url.searchParams.get('app_url') || Deno.env.get('DASHBOARD_URL') || 'https://dev.app.goself.in';

    if (!shopDomain || !/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shopDomain)) {
      return json({ error: 'Invalid or missing shop_domain' }, 400);
    }

    const SHOPIFY_KEY  = Deno.env.get('SHOPIFY_API_KEY') || '';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const callbackUrl  = `${SUPABASE_URL}/functions/v1/shopify-oauth-callback`;
    if (!SHOPIFY_KEY) return json({ error: 'Server misconfiguration' }, 500);

    // H-19: Generate a cryptographically random nonce (32 bytes = 64 hex chars)
    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // Store nonce with 10-minute TTL so callback can validate it
    const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    await supabase.from('oauth_nonces').insert({
      nonce,
      shop_domain: shopDomain,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    }).then(() => {}).catch((err: Error) => {
      // Table may not exist yet — log but don't fail (H-19 degrades gracefully)
      console.warn('[shopify-reconnect-url] oauth_nonces insert failed:', err.message);
    });

    const scopes = 'read_customers,read_orders,read_discounts,write_discounts,read_price_rules,write_price_rules';

    // Embed nonce in state so callback can verify it
    const state = encodeURIComponent(btoa(JSON.stringify({
      app_url:   appUrl,
      client_id: clientId || undefined,
      nonce,
      ts: Date.now(),
    })));

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
