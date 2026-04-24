import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyOAuthHmac } from '../_shared/shopify-hmac.ts';

const DASHBOARD_URL = 'https://goself.netlify.app';

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

function errorPage(message: string, status = 400) {
  return new Response(`<html><body><h1>Installation Error</h1><p>${message}</p></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

/**
 * Shopify OAuth callback — called after merchant authorises the app.
 *
 * Flow:
 *  1. Shopify redirects merchant to this URL with ?code=&hmac=&shop=&state=&timestamp=
 *  2. Verify HMAC using app client secret
 *  3. Exchange code for permanent access token via Shopify token endpoint
 *  4. Upsert store_installations row (shop_domain, access_token, scopes, client_id)
 *  5. Redirect merchant to the dashboard
 */
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const params = url.searchParams;

  const shop = params.get('shop') || '';
  const code = params.get('code') || '';
  const hmac = params.get('hmac') || '';

  // Basic parameter presence check
  if (!shop || !code || !hmac) {
    return errorPage('Missing required OAuth parameters (shop, code, hmac).');
  }

  // ── 1. Verify HMAC ───────────────────────────────────────────────────────
  const isValid = await verifyOAuthHmac(params);
  if (!isValid) {
    console.error('[shopify-oauth-callback] HMAC verification failed for shop:', shop);
    return errorPage('Invalid HMAC signature. Installation aborted.', 401);
  }

  // ── 2. Validate shop domain format ───────────────────────────────────────
  if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) {
    return errorPage('Invalid shop domain format.');
  }

  const clientId = Deno.env.get('SHOPIFY_CLIENT_ID');
  const clientSecret = Deno.env.get('SHOPIFY_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    console.error('[shopify-oauth-callback] SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET not set');
    return errorPage('App configuration error.', 500);
  }

  try {
    // ── 3. Exchange code for access token ────────────────────────────────
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[shopify-oauth-callback] Token exchange failed:', tokenRes.status, errText);
      return errorPage('Failed to exchange authorisation code. Please try installing again.', 502);
    }

    const tokenData = await tokenRes.json();
    const accessToken: string = tokenData.access_token;
    const scope: string = tokenData.scope || '';

    if (!accessToken) {
      console.error('[shopify-oauth-callback] No access_token in response');
      return errorPage('No access token received from Shopify.', 502);
    }

    // ── 4. Upsert store_installations ────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Check if there's an existing installation to carry over client_id
    const { data: existing } = await supabase
      .from('store_installations')
      .select('client_id')
      .eq('shop_domain', shop)
      .maybeSingle();

    const { error: upsertErr } = await supabase
      .from('store_installations')
      .upsert(
        {
          shop_domain: shop,
          access_token: accessToken,
          scopes: scope,
          installation_status: 'active',
          client_id: existing?.client_id || null,
          installed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'shop_domain' }
      );

    if (upsertErr) {
      console.error('[shopify-oauth-callback] Failed to save installation:', upsertErr.message);
      return errorPage('Failed to save installation. Please try again.', 500);
    }

    // ── 5. Register mandatory GDPR webhooks via Shopify API ──────────────
    // These are registered programmatically as a fallback; toml subscriptions
    // are the primary registration path once the app is submitted to the store.
    const gdprTopics = [
      { topic: 'customers/data_request', address: `${Deno.env.get('SUPABASE_URL')}/functions/v1/shopify-customers-data-request` },
      { topic: 'customers/redact',       address: `${Deno.env.get('SUPABASE_URL')}/functions/v1/shopify-customers-redact` },
      { topic: 'shop/redact',            address: `${Deno.env.get('SUPABASE_URL')}/functions/v1/shopify-shop-redact` },
    ];

    for (const { topic, address } of gdprTopics) {
      await fetch(`https://${shop}/admin/api/2026-01/webhooks.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhook: { topic, address, format: 'json' },
        }),
      }).catch((e) => console.error(`[shopify-oauth-callback] Webhook reg failed (${topic}):`, e.message));
    }

    // ── 6. Redirect to dashboard ─────────────────────────────────────────
    const dashboardUrl = `${DASHBOARD_URL}/shopify/installed?shop=${encodeURIComponent(shop)}`;
    return redirect(dashboardUrl);

  } catch (err) {
    console.error('[shopify-oauth-callback] Unhandled error:', (err as Error).message);
    return errorPage('An unexpected error occurred during installation.', 500);
  }
});
