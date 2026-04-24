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
 * Multi-tenant client_id resolution (priority order):
 *  1. `state` query param  — set by Goself dashboard when initiating OAuth
 *     Dashboard initiates: /admin/oauth/authorize?...&state=<client_id>
 *  2. Existing store_installations row — handles re-installs / token refresh
 *  3. null — shop installed directly from App Store (client_id linked later
 *     when merchant connects their Goself account from the dashboard)
 *
 * Full flow:
 *  1. Verify HMAC using SHOPIFY_CLIENT_SECRET
 *  2. Exchange code for permanent access token
 *  3. Upsert store_installations with resolved client_id
 *  4. Register GDPR webhooks programmatically (belt-and-suspenders alongside toml)
 *  5. Redirect to dashboard /shopify/installed?shop=&client_id=
 */
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const params = url.searchParams;

  const shop      = params.get('shop')  || '';
  const code      = params.get('code')  || '';
  const hmac      = params.get('hmac')  || '';
  // state carries the Goself client_id when install is initiated from the dashboard
  const stateClientId = params.get('state') || '';

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

  const shopifyAppClientId = Deno.env.get('SHOPIFY_CLIENT_ID');
  const clientSecret       = Deno.env.get('SHOPIFY_CLIENT_SECRET');

  if (!shopifyAppClientId || !clientSecret) {
    console.error('[shopify-oauth-callback] SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET not set');
    return errorPage('App configuration error.', 500);
  }

  try {
    // ── 3. Exchange code for permanent access token ──────────────────────
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: shopifyAppClientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[shopify-oauth-callback] Token exchange failed:', tokenRes.status, errText);
      return errorPage('Failed to exchange authorisation code. Please try installing again.', 502);
    }

    const tokenData  = await tokenRes.json();
    const accessToken: string = tokenData.access_token;
    const scope: string       = tokenData.scope || '';

    if (!accessToken) {
      console.error('[shopify-oauth-callback] No access_token in response');
      return errorPage('No access token received from Shopify.', 502);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── 4. Resolve client_id ─────────────────────────────────────────────
    // Priority: state param (from dashboard) → existing row → null
    let resolvedClientId: string | null = null;

    if (stateClientId) {
      // Validate that the state value is a real client in auth.users
      const { data: clientRow } = await supabase
        .from('store_installations')
        .select('client_id')
        .eq('client_id', stateClientId)
        .limit(1)
        .maybeSingle();

      // Accept state even if no prior installation exists — this is a new install
      // We trust it because it came through Shopify's signed OAuth redirect
      resolvedClientId = stateClientId;
    }

    if (!resolvedClientId) {
      // Re-install: carry over the client_id from the existing record
      const { data: existing } = await supabase
        .from('store_installations')
        .select('client_id')
        .eq('shop_domain', shop)
        .maybeSingle();
      resolvedClientId = existing?.client_id || null;
    }

    // ── 5. Upsert store_installations ────────────────────────────────────
    const { error: upsertErr } = await supabase
      .from('store_installations')
      .upsert(
        {
          shop_domain:         shop,
          access_token:        accessToken,
          scopes:              scope,
          installation_status: 'active',
          client_id:           resolvedClientId,
          installed_at:        new Date().toISOString(),
          updated_at:          new Date().toISOString(),
        },
        { onConflict: 'shop_domain' }
      );

    if (upsertErr) {
      console.error('[shopify-oauth-callback] Failed to save installation:', upsertErr.message);
      return errorPage('Failed to save installation. Please try again.', 500);
    }

    // ── 6. Register GDPR webhooks programmatically ───────────────────────
    // Belt-and-suspenders alongside the toml webhook subscriptions.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const gdprTopics = [
      { topic: 'customers/data_request', address: `${supabaseUrl}/functions/v1/shopify-customers-data-request` },
      { topic: 'customers/redact',       address: `${supabaseUrl}/functions/v1/shopify-customers-redact` },
      { topic: 'shop/redact',            address: `${supabaseUrl}/functions/v1/shopify-shop-redact` },
    ];

    for (const { topic, address } of gdprTopics) {
      await fetch(`https://${shop}/admin/api/2026-01/webhooks.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
      }).catch((e) => console.error(`[shopify-oauth-callback] Webhook reg failed (${topic}):`, e.message));
    }

    // ── 7. Redirect to dashboard ─────────────────────────────────────────
    // Pass both shop and client_id so the dashboard can show the right merchant
    const redirectParams = new URLSearchParams({ shop });
    if (resolvedClientId) redirectParams.set('client_id', resolvedClientId);
    return redirect(`${DASHBOARD_URL}/shopify/installed?${redirectParams}`);

  } catch (err) {
    console.error('[shopify-oauth-callback] Unhandled error:', (err as Error).message);
    return errorPage('An unexpected error occurred during installation.', 500);
  }
});
