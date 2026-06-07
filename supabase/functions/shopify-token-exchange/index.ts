/**
 * shopify-token-exchange
 *
 * Managed-installation entry point (use_legacy_install_flow = false).
 *
 * Shopify no longer fires the legacy authorization-code redirect on install, so
 * `shopify-oauth-callback` never runs and `store_installations` is never created.
 * Instead, the embedded install bootstrap page (/shopify/install) obtains a
 * Shopify *session token* (id_token JWT) and POSTs it here. We exchange that
 * session token for a long-lived offline access token via OAuth Token Exchange,
 * then persist the installation exactly like the legacy callback did and return a
 * magic link the bootstrap uses to break out of the iframe into the dashboard.
 *
 * Security model:
 * - Session token JWT verified (HS256 with the app secret) before it is trusted
 * - `dest` claim must match the posted shop — prevents cross-shop token injection
 * - `aud` claim must equal our API key; `exp` must be in the future
 * - Access token encrypted at rest (no-op if ACCESS_TOKEN_ENCRYPTION_KEY unset)
 * - Service-role DB writes; the global app secret is never persisted (C-02)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { encryptToken } from "../_shared/token-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // embedded bootstrap may be served from the shop/admin origin
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DASHBOARD_URL_ENV = Deno.env.get("DASHBOARD_URL")?.trim() || "";
const APP_URL_ENV       = Deno.env.get("APP_URL")?.trim() || "";
const ALLOWED_APP_URLS  = (Deno.env.get("ALLOWED_APP_URLS") || "").split(",").map((s) => s.trim()).filter(Boolean);
const DEFAULT_ALLOWED   = ["https://app.goself.in", "https://dev.app.goself.in", "https://ai.goself.in"];

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const SUBJECT_ID_TOKEN      = "urn:ietf:params:oauth:token-type:id_token";
const REQUEST_OFFLINE_TOKEN = "urn:ietf:params:oauth:token-type:offline-access-token";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const sessionToken = (body.session_token ?? body.id_token) as string | undefined;
    const shopRaw      = body.shop as string | undefined;
    const appUrlHint   = body.app_url as string | undefined;

    if (!sessionToken || !shopRaw) {
      return json({ success: false, error: "session_token and shop are required" }, 400);
    }

    const shop = shopRaw.trim().toLowerCase();
    if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) {
      return json({ success: false, error: "Invalid shop domain" }, 400);
    }

    const SHOPIFY_KEY = Deno.env.get("SHOPIFY_API_KEY") || "";
    const SHOPIFY_SEC = Deno.env.get("SHOPIFY_API_SECRET") || "";
    if (!SHOPIFY_KEY || !SHOPIFY_SEC) {
      console.error("[token-exchange] Missing SHOPIFY_API_KEY/SECRET");
      return json({ success: false, error: "Server misconfiguration" }, 500);
    }

    // ── 1. Verify the Shopify session token (id_token JWT) ───────────────────
    const claims = await verifySessionToken(sessionToken, SHOPIFY_SEC, SHOPIFY_KEY).catch((e) => {
      console.error("[token-exchange] session token verify failed:", e?.message ?? e);
      return null;
    });
    if (!claims) return json({ success: false, error: "Invalid session token" }, 401);

    // `dest` is https://{shop} — it MUST match the posted shop (anti-injection)
    const destShop = (claims.dest || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    if (destShop !== shop) {
      console.error(`[token-exchange] dest/shop mismatch: dest=${destShop} shop=${shop}`);
      return json({ success: false, error: "Shop mismatch" }, 401);
    }

    // ── 2. Exchange the session token for an offline access token ────────────
    const exchangeRes = await fetchWithTimeout(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: SHOPIFY_KEY,
        client_secret: SHOPIFY_SEC,
        grant_type: TOKEN_EXCHANGE_GRANT,
        subject_token: sessionToken,
        subject_token_type: SUBJECT_ID_TOKEN,
        requested_token_type: REQUEST_OFFLINE_TOKEN,
      }),
    }, 8000);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (!exchangeRes.ok) {
      // If the install already exists, treat this as a benign re-open and SSO anyway.
      const { data: existing } = await supabase
        .from("store_installations")
        .select("id, client_id, shop_email, shop_name, shop_owner")
        .eq("shop_domain", shop)
        .eq("installation_status", "active")
        .maybeSingle();
      if (existing) {
        const link = await issueMagicLink(supabase, existing.shop_email, existing.shop_owner || existing.shop_name || shop, shop, existing.client_id, appUrlHint);
        if (link) return json({ success: true, redirect: link });
      }
      console.error(`[token-exchange] exchange failed: ${exchangeRes.status}`);
      return json({ success: false, error: "Token exchange failed" }, 502);
    }

    const { access_token: accessToken, scope } = await exchangeRes.json();
    if (!accessToken) return json({ success: false, error: "No access token returned" }, 502);
    const scopes: string[] = scope ? scope.split(",").map((s: string) => s.trim()) : [];

    // ── 3. Resolve or create the client record ───────────────────────────────
    const storeName     = shop.replace(".myshopify.com", "");
    const fallbackEmail = `${storeName}@shopify.com`;
    let clientId: string | null = null;

    const { data: existingInstall } = await supabase
      .from("store_installations")
      .select("client_id, installed_at, webhooks_registered")
      .eq("shop_domain", shop)
      .maybeSingle();
    clientId = existingInstall?.client_id ?? null;
    const isReopen = Boolean(existingInstall);

    if (!clientId) {
      const { data: byEmail } = await supabase
        .from("clients").select("id").eq("contact_email", fallbackEmail).maybeSingle();
      if (byEmail) {
        clientId = byEmail.id;
      } else {
        const slug = `${storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
        const { data: newClient, error: clientErr } = await supabase
          .from("clients")
          .insert({ name: storeName, slug, contact_email: fallbackEmail, primary_color: "#3b82f6", is_active: true })
          .select("id").single();
        if (clientErr) {
          const { data: race } = await supabase.from("clients").select("id").eq("contact_email", fallbackEmail).maybeSingle();
          clientId = race?.id ?? null;
        } else {
          clientId = newClient.id;
        }
      }
    }

    // ── 4. Upsert the installation (token encrypted at rest) ─────────────────
    const encryptedToken = await encryptToken(accessToken).catch(() => accessToken);

    // On re-open we refresh the token + activity only — never overwrite the original
    // installed_at, billing, or app_settings, and don't reset webhooks_registered.
    const installRow: Record<string, unknown> = {
      client_id: clientId, shop_domain: shop, myshopify_domain: shop,
      shop_name: storeName, shop_email: fallbackEmail,
      installation_status: "active",
      last_active_at: new Date().toISOString(),
      access_token: encryptedToken, shopify_access_token: encryptedToken,
      api_version: "2025-01", scopes,
    };
    if (!isReopen) {
      Object.assign(installRow, {
        installed_at: new Date().toISOString(),
        webhooks_registered: false, billing_plan: "free", billing_status: "active",
        app_settings: { auto_create_members: true, auto_assign_rewards: true, email_notifications: true },
      });
    }

    const { data: installation, error: installErr } = await supabase
      .from("store_installations")
      .upsert(installRow, { onConflict: "shop_domain", ignoreDuplicates: false })
      .select("id").single();

    if (installErr) {
      console.error("[token-exchange] install upsert failed:", installErr.message);
      return json({ success: false, error: "Install persistence failed" }, 500);
    }
    const installationId = installation.id;

    // ── 5. Fetch real merchant details (parallel with webhook registration) ──
    // Note: app-level webhooks declared in shopify.app.toml are auto-registered by
    // Shopify on managed install. We still register order webhooks on first install
    // for parity + store_webhooks health tracking. Skip the redundant work on re-open.
    const needsWebhooks = !isReopen || !existingInstall?.webhooks_registered;
    const [shopDetailsResult] = await Promise.allSettled([
      fetchShopDetails(shop, accessToken, 5000),
      needsWebhooks
        ? registerWebhooks(shop, accessToken, installationId, clientId, supabase)
        : Promise.resolve(),
    ]);

    const shopData      = shopDetailsResult.status === "fulfilled" ? shopDetailsResult.value : null;
    const merchantEmail = shopData?.email && !shopData.email.endsWith("@shopify.com") ? shopData.email : fallbackEmail;
    const merchantName  = shopData?.shop_owner || shopData?.name || storeName;

    if (shopData && merchantEmail !== fallbackEmail) {
      await supabase.from("store_installations").update({
        shop_email: merchantEmail, shop_name: shopData.name || storeName,
        shop_owner: shopData.shop_owner || null, shop_phone: shopData.phone || null,
        shop_currency: shopData.currency || null,
      }).eq("id", installationId);
    }

    // ── 6. Background: install default plugins (first install only) ──────────
    if (!isReopen) {
      const bg = installDefaultPlugins(installationId, clientId, supabase);
      try { (globalThis as any).EdgeRuntime?.waitUntil(bg); } catch {}
    }

    // ── 7. Generate magic link + upsert profile, return to bootstrap ─────────
    const magicLink = await issueMagicLink(supabase, merchantEmail, merchantName, shop, clientId, appUrlHint);
    if (!magicLink) {
      // Install persisted; SSO link failed. Bootstrap falls back to manual login.
      return json({ success: true, redirect: null });
    }

    console.log(`[token-exchange] install + SSO ready for ${shop}`);
    return json({ success: true, redirect: magicLink });

  } catch (err: any) {
    console.error("[token-exchange] Unhandled error:", err?.message ?? err);
    return json({ success: false, error: "Internal server error" }, 500);
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveSafeDashboardUrl(hint?: string): string {
  const allowed = [DASHBOARD_URL_ENV, APP_URL_ENV, ...ALLOWED_APP_URLS, ...DEFAULT_ALLOWED]
    .map(normalizeOrigin).filter((o): o is string => Boolean(o));
  for (const candidate of [hint, DASHBOARD_URL_ENV, APP_URL_ENV, ...DEFAULT_ALLOWED]) {
    const origin = normalizeOrigin(candidate);
    if (origin && allowed.includes(origin)) return origin;
  }
  return "https://app.goself.in";
}

function normalizeOrigin(url?: string): string | null {
  if (!url) return null;
  try { const p = new URL(url); return ["https:", "http:"].includes(p.protocol) ? p.origin : null; }
  catch { return null; }
}

async function issueMagicLink(
  supabase: any, email: string, fullName: string,
  shop: string, clientId: string | null, appUrlHint?: string,
): Promise<string | null> {
  const dashboardUrl = resolveSafeDashboardUrl(appUrlHint);
  const redirectTo = `${dashboardUrl}/auth/shopify-callback?shop=${encodeURIComponent(shop)}`;
  const tryGenerate = () => supabase.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } });

  let { data, error } = await tryGenerate();
  if (error) {
    const { error: createErr } = await supabase.auth.admin.createUser({
      email, email_confirm: true,
      user_metadata: { shop_domain: shop, client_id: clientId },
    });
    if (createErr && !createErr.message.toLowerCase().includes("already")) {
      console.error("[token-exchange] createUser failed:", createErr.message);
      return null;
    }
    const retry = await tryGenerate();
    if (retry.error) { console.error("[token-exchange] magic retry failed:", retry.error.message); return null; }
    data = retry.data;
  }

  const magicLink = data?.properties?.action_link;
  const userId    = data?.user?.id;
  if (!magicLink) return null;

  if (userId) {
    await supabase.from("profiles").upsert(
      { id: userId, email, full_name: fullName, role: "client", client_id: clientId || null },
      { onConflict: "id", ignoreDuplicates: false },
    ).catch((e: any) => console.error("[token-exchange] profile upsert:", e.message));
  }
  return magicLink;
}

/** Verify a Shopify session token JWT (HS256, signed with the app secret). */
async function verifySessionToken(token: string, secret: string, apiKey: string): Promise<Record<string, any> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  const [headerB64, payloadB64, sigB64] = parts;

  // Verify HS256 signature over `header.payload`
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC", key,
    base64UrlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new Error("bad signature");

  const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp < now) throw new Error("expired");
  if (typeof claims.nbf === "number" && claims.nbf > now + 5) throw new Error("not yet valid");
  if (claims.aud && claims.aud !== apiKey) throw new Error("aud mismatch");

  return claims;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function fetchShopDetails(shop: string, accessToken: string, ms: number): Promise<any> {
  try {
    const res = await fetchWithTimeout(
      `https://${shop}/admin/api/2025-01/shop.json`,
      { headers: { "X-Shopify-Access-Token": accessToken } }, ms,
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
  const topics     = ["orders/create", "orders/updated", "orders/paid", "customers/create", "customers/update"];
  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/shopify-order-webhook`;
  let success      = 0;

  for (const topic of topics) {
    try {
      const res = await fetchWithTimeout(`https://${shop}/admin/api/2025-01/webhooks.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ webhook: { topic, address: webhookUrl, format: "json" } }),
      }, 5000);
      const { webhook } = await res.json();
      if (res.ok && webhook) {
        await supabase.from("store_webhooks").upsert({
          store_installation_id: installationId, client_id: clientId,
          webhook_topic: topic, shopify_webhook_id: webhook.id.toString(),
          webhook_address: webhookUrl, status: "active", registered_at: new Date().toISOString(),
        }, { onConflict: "store_installation_id,webhook_topic" });
        success++;
      }
    } catch { /* a 422 "already exists" is expected on re-open — ignore */ }
  }

  await supabase.from("store_installations").update({
    webhooks_registered: success > 0,
    webhooks_registered_at: new Date().toISOString(),
    webhook_health_status: success === topics.length ? "healthy" : "degraded",
  }).eq("id", installationId);
}

async function installDefaultPlugins(installationId: string, clientId: string | null, supabase: any): Promise<void> {
  const plugins = [
    { type: "loyalty",   name: "Loyalty Points System", version: "1.0.0" },
    { type: "rewards",   name: "Rewards Program",        version: "1.0.0" },
    { type: "referral",  name: "Referral Program",       version: "1.0.0" },
    { type: "campaigns", name: "Campaign Management",    version: "1.0.0" },
  ];
  await supabase.from("store_plugins").upsert(
    plugins.map((p) => ({
      store_installation_id: installationId, client_id: clientId,
      plugin_type: p.type, plugin_name: p.name, plugin_version: p.version,
      status: "active", installed_at: new Date().toISOString(),
      plugin_config: {}, feature_flags: {},
    })),
    { onConflict: "store_installation_id,plugin_type" },
  );
}
