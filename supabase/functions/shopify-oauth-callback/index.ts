import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyOAuthHmac } from '../_shared/shopify-hmac.ts';

const DEFAULT_DASHBOARD_URL = 'https://dev.app.goself.in';
const DASHBOARD_URL = Deno.env.get('DASHBOARD_URL') ?? DEFAULT_DASHBOARD_URL;

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
 *  5. Redirect to the Goself portal root so ShopifyLanding can complete SSO
 */
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const params = url.searchParams;

  const shop      = params.get('shop')  || '';
  const code      = params.get('code')  || '';
  const hmac      = params.get('hmac')  || '';
  const state = params.get('state') || '';

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

  const stateData = parseState(state);
  const stateClientId = stateData.client_id || '';
  const dashboardUrl = resolveDashboardUrl(stateData.app_url);

  const shopifyAppClientId = Deno.env.get('SHOPIFY_API_KEY') || Deno.env.get('SHOPIFY_CLIENT_ID');
  const clientSecret       = Deno.env.get('SHOPIFY_API_SECRET') || Deno.env.get('SHOPIFY_CLIENT_SECRET');

  if (!shopifyAppClientId || !clientSecret) {
    console.error('[shopify-oauth-callback] Shopify API key or secret not set');
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

    const storeName = shop.replace('.myshopify.com', '');
    const fallbackEmail = `${storeName}@shopify.com`;
    const shopDetails = await fetchShopDetails(shop, accessToken);
    const shopEmail = shopDetails?.email || fallbackEmail;
    const shopName = shopDetails?.name || storeName;

    // ── 4. Resolve client_id ─────────────────────────────────────────────
    // Priority: state param (from dashboard) → existing row → null
    let resolvedClientId: string | null = null;

    if (stateClientId) {
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

    if (!resolvedClientId) {
      const { data: existingClient } = await supabase
        .from('clients')
        .select('id')
        .eq('contact_email', shopEmail)
        .maybeSingle();

      if (existingClient) {
        resolvedClientId = existingClient.id;
      } else {
        const baseSlug = storeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const slug = `${baseSlug}-${Date.now().toString(36)}`;
        const { data: newClient, error: clientError } = await supabase
          .from('clients')
          .insert({
            name: shopName,
            slug,
            description: `Shopify store: ${shop}`,
            contact_email: shopEmail,
            primary_color: '#3b82f6',
            is_active: true,
          })
          .select('id')
          .single();

        if (clientError) {
          console.error('[shopify-oauth-callback] Failed to create client:', clientError.message);
          return errorPage('Failed to create client profile. Please try again.', 500);
        }
        resolvedClientId = newClient.id;
      }
    }

    // ── 5. Upsert store_installations ────────────────────────────────────
    const { error: upsertErr } = await supabase
      .from('store_installations')
      .upsert(
        {
          shop_domain:         shop,
          myshopify_domain:    shop,
          shop_name:           shopName,
          shop_email:          shopEmail,
          shop_owner:          shopDetails?.shop_owner || null,
          shop_phone:          shopDetails?.phone || null,
          shop_country:        shopDetails?.country_code || shopDetails?.country_name || null,
          shop_currency:       shopDetails?.currency || null,
          access_token:        accessToken,
          shopify_access_token: accessToken,
          scopes:              scope ? scope.split(',').map((s: string) => s.trim()) : [],
          installation_status: 'active',
          client_id:           resolvedClientId,
          installed_at:        new Date().toISOString(),
          last_active_at:      new Date().toISOString(),
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

    // ── 7. Redirect to portal landing ────────────────────────────────────
    // ShopifyLanding will call shopify-merchant-login and finish SSO.
    const redirectParams = new URLSearchParams({ shop });
    if (resolvedClientId) redirectParams.set('client_id', resolvedClientId);
    return redirect(`${dashboardUrl}/?${redirectParams}`);

  } catch (err) {
    console.error('[shopify-oauth-callback] Unhandled error:', (err as Error).message);
    return errorPage('An unexpected error occurred during installation.', 500);
  }
});

function parseState(state: string): Record<string, string> {
  if (!state) return {};
  try {
    return JSON.parse(atob(decodeURIComponent(state.replace(/ /g, '+'))));
  } catch {
    return /^[0-9a-f-]{36}$/i.test(state) ? { client_id: state } : {};
  }
}

function resolveDashboardUrl(stateAppUrl?: string): string {
  const allowedOrigins = ['https://dev.app.goself.in', 'https://app.goself.in'];
  for (const candidate of [stateAppUrl, DASHBOARD_URL]) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (allowedOrigins.includes(parsed.origin)) return parsed.origin;
    } catch {
      // Ignore invalid state/env URL and use the development portal fallback.
    }
  }
  return DEFAULT_DASHBOARD_URL;
}

async function fetchShopDetails(shop: string, accessToken: string) {
  try {
    const response = await fetch(`https://${shop}/admin/api/2026-01/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.shop || null;
  } catch (error) {
    console.error('[shopify-oauth-callback] Failed to fetch shop details:', error);
    return null;
  }
}
