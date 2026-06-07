/**
 * shopify-oauth-callback
 *
 * Security model (enterprise-grade):
 * - HMAC-verified by Shopify on every request — no unauthenticated entry
 * - shop.json fetched server-side (parallel with webhook registration)
 * - Magic link generated server-side using service role
 * - Profile upserted server-side before the client follows the link
 * - Redirect is a 302 to the magic link — magic link URL never reaches client JS
 * - No PII flows through URL params after the initial redirect
 * - Timestamp verified on state param to prevent replay attacks
 * - Redirect target validated against explicit allowlist (open-redirect prevention)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { encryptToken } from '../_shared/token-crypto.ts';

const DASHBOARD_URL_ENV  = Deno.env.get('DASHBOARD_URL')?.trim()  || '';
const APP_URL_ENV        = Deno.env.get('APP_URL')?.trim()        || '';
const ALLOWED_APP_URLS   = (Deno.env.get('ALLOWED_APP_URLS') || '').split(',').map(s => s.trim()).filter(Boolean);
const DEFAULT_ALLOWED    = ['https://app.goself.in', 'https://dev.app.goself.in'];

Deno.serve(async (req: Request) => {
  const url   = new URL(req.url);
  const code  = url.searchParams.get('code')  || '';
  const shop  = url.searchParams.get('shop')  || '';
  const state = url.searchParams.get('state') || '';

  if (!code || !shop) return new Response('Missing required parameters', { status: 400 });
  if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) return new Response('Invalid shop domain', { status: 400 });

  // ── 1. Verify Shopify HMAC ─────────────────────────────────────────────────
  const shopifySecret = Deno.env.get('SHOPIFY_API_SECRET') || '';
  if (!shopifySecret) return new Response('Server misconfiguration', { status: 500 });

  if (!(await verifyShopifyHmac(url, shopifySecret))) {
    console.error('[oauth-callback] HMAC failed for', shop);
    return new Response('Unauthorized', { status: 401 });
  }

  // ── 2. Decode state → resolve safe redirect target ────────────────────────
  let stateData: Record<string, any> = {};
  if (state) {
    try { stateData = JSON.parse(atob(decodeURIComponent(state.replace(/ /g, '+')))); } catch {}
  }
  const dashboardUrl = resolveSafeDashboardUrl(stateData.app_url);
  if (!dashboardUrl) {
    console.error('[oauth-callback] No safe dashboard URL for', shop);
    return new Response('Server misconfiguration', { status: 500 });
  }

  // H-20: Verify state timestamp freshness (max 5 minutes)
  if (stateData.ts && Math.floor(Date.now() / 1000) - Math.floor(stateData.ts / 1000) > 300) {
    console.error('[oauth-callback] State timestamp expired for', shop);
    return new Response('OAuth request expired', { status: 401 });
  }

  const supabase      = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const SHOPIFY_KEY   = Deno.env.get('SHOPIFY_API_KEY')    || '';
  const SHOPIFY_SEC   = Deno.env.get('SHOPIFY_API_SECRET') || '';

  if (!SHOPIFY_KEY || !SHOPIFY_SEC) {
    return redirect(`${dashboardUrl}/?shop=${shop}&error=missing_credentials`);
  }

  // H-19: Validate nonce if present (degrades gracefully if oauth_nonces table not yet created)
  if (stateData.nonce) {
    try {
      const { data: nonceRow } = await supabase
        .from('oauth_nonces')
        .select('id, expires_at')
        .eq('nonce', stateData.nonce)
        .eq('shop_domain', shop)
        .maybeSingle();

      if (!nonceRow) {
        console.error('[oauth-callback] Invalid or missing nonce for', shop);
        return new Response('Invalid OAuth state — possible CSRF attempt', { status: 401 });
      }

      if (new Date(nonceRow.expires_at) < new Date()) {
        console.error('[oauth-callback] Nonce expired for', shop);
        return new Response('OAuth request expired', { status: 401 });
      }

      // Consume the nonce (delete so it can't be replayed)
      await supabase.from('oauth_nonces').delete().eq('id', nonceRow.id);
    } catch (nonceErr: any) {
      console.warn('[oauth-callback] Nonce validation skipped (table may not exist):', nonceErr.message);
    }
  }

  try {
    // ── 3. Exchange code for access token ──────────────────────────────────
    const tokenRes = await fetchWithTimeout(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: SHOPIFY_KEY, client_secret: SHOPIFY_SEC, code }),
    }, 8000);

    if (!tokenRes.ok) {
      // Double-invoke guard: Shopify sometimes fires the callback twice with one code.
      // If an active installation already exists, redirect rather than error.
      const { data: existing } = await supabase
        .from('store_installations').select('id')
        .eq('shop_domain', shop).eq('installation_status', 'active').maybeSingle();
      if (existing) return redirect(`${dashboardUrl}/?shop=${shop}`);
      throw new Error(`Token exchange failed: ${tokenRes.status}`);
    }

    const { access_token: accessToken, scope } = await tokenRes.json();
    if (!accessToken) throw new Error('No access token in response');
    const scopes: string[] = scope ? scope.split(',').map((s: string) => s.trim()) : [];

    // ── 4. Resolve or create client record ────────────────────────────────
    const storeName     = shop.replace('.myshopify.com', '');
    const fallbackEmail = `${storeName}@shopify.com`;
    let clientId: string | null = stateData.client_id || null;

    if (!clientId) {
      const { data: existingInstall } = await supabase
        .from('store_installations').select('client_id').eq('shop_domain', shop).maybeSingle();
      clientId = existingInstall?.client_id || null;
    }

    if (!clientId) {
      const { data: byEmail } = await supabase
        .from('clients').select('id').eq('contact_email', fallbackEmail).maybeSingle();
      if (byEmail) {
        clientId = byEmail.id;
      } else {
        const slug = `${storeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString(36)}`;
        const { data: newClient, error: clientErr } = await supabase
          .from('clients')
          .insert({ name: storeName, slug, contact_email: fallbackEmail, primary_color: '#3b82f6', is_active: true })
          .select('id').single();
        if (clientErr) {
          const { data: race } = await supabase.from('clients').select('id').eq('contact_email', fallbackEmail).maybeSingle();
          clientId = race?.id || null;
        } else {
          clientId = newClient.id;
        }
      }
    }

    // ── 5. Upsert installation ────────────────────────────────────────────────
    // Encrypt at rest. encryptToken() is FLAG-GATED (plaintext unless
    // ENCRYPT_ACCESS_TOKENS=true), so this ships safely before the flag is flipped.
    // All consumers now decryptToken() (a no-op for plaintext). Table is also
    // RLS-locked to service_role (security C-01).
    const storedToken = await encryptToken(accessToken);

    const { data: installation, error: installErr } = await supabase
      .from('store_installations')
      .upsert({
        client_id: clientId, shop_domain: shop, myshopify_domain: shop,
        shop_name: storeName, shop_email: fallbackEmail,
        installation_status: 'active',
        installed_at: new Date().toISOString(), last_active_at: new Date().toISOString(),
        access_token: storedToken, shopify_access_token: storedToken,
        api_version: '2025-01', scopes, // C-02: shopify_api_secret must never be persisted to DB
        webhooks_registered: false, billing_plan: 'free', billing_status: 'active',
        app_settings: { auto_create_members: true, auto_assign_rewards: true, email_notifications: true },
      }, { onConflict: 'shop_domain', ignoreDuplicates: false })
      .select('id').single();

    if (installErr) throw installErr;
    const installationId = installation.id;

    // ── 6. Parallel: shop.json (real email) + webhook registration ─────────
    const [shopDetailsResult] = await Promise.allSettled([
      fetchShopDetails(shop, accessToken, 5000),
      registerWebhooks(shop, accessToken, installationId, clientId, supabase),
    ]);

    const shopData      = shopDetailsResult.status === 'fulfilled' ? shopDetailsResult.value : null;
    const merchantEmail = shopData?.email && !shopData.email.endsWith('@shopify.com') ? shopData.email : fallbackEmail;
    const merchantName  = shopData?.shop_owner || shopData?.name || storeName;

    // Update installation with real shop details
    if (shopData && merchantEmail !== fallbackEmail) {
      await supabase.from('store_installations').update({
        shop_email: merchantEmail, shop_name: shopData.name || storeName,
        shop_owner: shopData.shop_owner || null, shop_phone: shopData.phone || null,
        shop_currency: shopData.currency || null,
      }).eq('id', installationId);
    }

    // ── 7. Generate magic link server-side ────────────────────────────────
    // The magic link is used only as a redirect target — never returned to JS.
    const redirectTo = `${dashboardUrl}/auth/shopify-callback?shop=${encodeURIComponent(shop)}&client_id=${encodeURIComponent(clientId || '')}`;
    const magicLink  = await generateMerchantMagicLink(supabase, merchantEmail, merchantName, shop, clientId, redirectTo);

    // ── 8. Background: install default plugins ────────────────────────────
    const bg = installDefaultPlugins(installationId, clientId, supabase);
    try { (globalThis as any).EdgeRuntime?.waitUntil(bg); } catch {}

    // ── 9. Redirect through magic link — never exposed to client JS ────────
    if (magicLink) {
      console.log(`[oauth-callback] SSO redirect for ${shop}`);
      return redirect(magicLink);
    }

    // Fallback: redirect to app (ShopifyLanding can handle re-open via HMAC)
    console.warn(`[oauth-callback] Magic link generation failed for ${shop}, falling back`);
    return redirect(`${dashboardUrl}/?shop=${shop}`);

  } catch (err: any) {
    console.error('[oauth-callback] Error:', err.message);
    return redirect(`${dashboardUrl}/?shop=${shop}&error=oauth_failed`);
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

async function generateMerchantMagicLink(
  supabase: any, email: string, fullName: string,
  shopDomain: string, clientId: string | null, redirectTo: string,
): Promise<string | null> {
  const tryGenerate = () => supabase.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo } });

  let { data, error } = await tryGenerate();

  if (error) {
    const { error: createErr } = await supabase.auth.admin.createUser({
      email, email_confirm: true,
      user_metadata: { shop_domain: shopDomain, client_id: clientId },
    });
    if (createErr && !createErr.message.toLowerCase().includes('already')) {
      console.error('[generateMagicLink] createUser failed:', createErr.message);
      return null;
    }
    const retry = await tryGenerate();
    if (retry.error) { console.error('[generateMagicLink] retry failed:', retry.error.message); return null; }
    data = retry.data;
  }

  const magicLink = data?.properties?.action_link;
  const userId    = data?.user?.id;
  if (!magicLink) return null;

  // Upsert profile server-side so AuthContext finds it immediately on redirect.
  // NOTE: supabase-js v2 builders have no .catch() — await + destructure instead.
  if (userId) {
    const { error: pErr } = await supabase.from('profiles').upsert(
      { id: userId, email, full_name: fullName, role: 'client', client_id: clientId || null },
      { onConflict: 'id', ignoreDuplicates: false },
    );
    if (pErr) console.error('[generateMagicLink] profile upsert:', pErr.message);
  }

  return magicLink;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function fetchShopDetails(shop: string, accessToken: string, ms: number): Promise<any> {
  try {
    const res = await fetchWithTimeout(
      `https://${shop}/admin/api/2025-01/shop.json`,
      { headers: { 'X-Shopify-Access-Token': accessToken } }, ms,
    );
    if (!res.ok) return null;
    const { shop: data } = await res.json();
    return data || null;
  } catch { return null; }
}

async function registerWebhooks(
  shop: string, accessToken: string, installationId: string,
  clientId: string | null, supabase: any,
): Promise<void> {
  const topics     = ['orders/create', 'orders/updated', 'orders/paid', 'customers/create', 'customers/update'];
  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/shopify-order-webhook`;
  let success      = 0;

  for (const topic of topics) {
    try {
      const res  = await fetchWithTimeout(`https://${shop}/admin/api/2025-01/webhooks.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook: { topic, address: webhookUrl, format: 'json' } }),
      }, 5000);
      const { webhook } = await res.json();
      if (res.ok && webhook) {
        await supabase.from('store_webhooks').upsert({
          store_installation_id: installationId, client_id: clientId,
          webhook_topic: topic, shopify_webhook_id: webhook.id.toString(),
          webhook_address: webhookUrl, status: 'active', registered_at: new Date().toISOString(),
        }, { onConflict: 'store_installation_id,webhook_topic' });
        success++;
      }
    } catch {}
  }

  await supabase.from('store_installations').update({
    webhooks_registered: success > 0,
    webhooks_registered_at: new Date().toISOString(),
    webhook_health_status: success === topics.length ? 'healthy' : 'degraded',
  }).eq('id', installationId);
}

async function installDefaultPlugins(installationId: string, clientId: string | null, supabase: any): Promise<void> {
  const plugins = [
    { type: 'loyalty',   name: 'Loyalty Points System', version: '1.0.0' },
    { type: 'rewards',   name: 'Rewards Program',        version: '1.0.0' },
    { type: 'referral',  name: 'Referral Program',       version: '1.0.0' },
    { type: 'campaigns', name: 'Campaign Management',    version: '1.0.0' },
  ];
  await supabase.from('store_plugins').upsert(
    plugins.map(p => ({
      store_installation_id: installationId, client_id: clientId,
      plugin_type: p.type, plugin_name: p.name, plugin_version: p.version,
      status: 'active', installed_at: new Date().toISOString(),
      plugin_config: {}, feature_flags: {},
    })),
    { onConflict: 'store_installation_id,plugin_type' },
  );
}

function normalizeOrigin(url?: string): string | null {
  if (!url) return null;
  try { const p = new URL(url); return ['https:', 'http:'].includes(p.protocol) ? p.origin : null; }
  catch { return null; }
}

function resolveSafeDashboardUrl(stateAppUrl?: string): string | null {
  const allowed = [DASHBOARD_URL_ENV, APP_URL_ENV, ...ALLOWED_APP_URLS, ...DEFAULT_ALLOWED]
    .map(normalizeOrigin).filter((o): o is string => Boolean(o));
  for (const candidate of [stateAppUrl, DASHBOARD_URL_ENV, APP_URL_ENV, ...DEFAULT_ALLOWED]) {
    const origin = normalizeOrigin(candidate);
    if (origin && allowed.includes(origin) && candidate) return candidate;
  }
  return null;
}

async function verifyShopifyHmac(url: URL, secret: string): Promise<boolean> {
  const hmac = url.searchParams.get('hmac');
  if (!hmac) return false;
  const msg = Array.from(url.searchParams.entries())
    .filter(([k]) => k !== 'hmac').sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig      = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === hmac;
}
