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
// requested_token_type uses Shopify's OWN namespace (urn:shopify:...), NOT urn:ietf.
// Using the ietf form makes Shopify reject the exchange (→ 502 in our handler).
const REQUEST_OFFLINE_TOKEN = "urn:shopify:params:oauth:token-type:offline-access-token";

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
    // Read session token from Authorization header first (satisfies Shopify's
    // "session tokens for user authentication" App Store check), then fall back
    // to body for any cached/old frontend builds still in flight.
    const sessionToken = (
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
      body.session_token ||
      body.id_token
    ) as string | undefined;
    const shopRaw      = body.shop as string | undefined;
    const appUrlHint   = body.app_url as string | undefined;

    if (!sessionToken) {
      return json({ success: false, error: "session_token is required" }, 400);
    }

    const SHOPIFY_KEY = Deno.env.get("SHOPIFY_API_KEY") || "";
    const SHOPIFY_SEC = Deno.env.get("SHOPIFY_API_SECRET") || "";
    if (!SHOPIFY_KEY || !SHOPIFY_SEC) {
      console.error("[token-exchange] Missing SHOPIFY_API_KEY/SECRET");
      return json({ success: false, error: "Server misconfiguration" }, 500);
    }

    // ── 1. Verify the Shopify session token (id_token JWT) ───────────────────
    // Verify BEFORE using shopRaw — the verified dest claim is a trusted fallback
    // for shop when the body field is absent (e.g. App Bridge config shape changed).
    const claims = await verifySessionToken(sessionToken, SHOPIFY_SEC, SHOPIFY_KEY).catch((e) => {
      console.error("[token-exchange] session token verify failed:", e?.message ?? e);
      return null;
    });
    if (!claims) return json({ success: false, error: "Invalid session token" }, 401);

    // `dest` is https://{shop} — extract the host as canonical shop domain.
    const destShop = (claims.dest || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();

    // Prefer the body-supplied shop; fall back to the JWT dest claim.
    const shop = (shopRaw ? shopRaw.trim().toLowerCase() : destShop);

    if (!shop || !/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) {
      return json({ success: false, error: "Invalid shop domain" }, 400);
    }

    // When both are present they MUST match (anti cross-shop injection).
    if (shopRaw && destShop && destShop !== shop) {
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
        const ml = await issueMagicLink(supabase, existing.shop_email, existing.shop_owner || existing.shop_name || shop, shop, existing.client_id, appUrlHint);
        if (ml) {
          const sessionTokens = await exchangeOtpForSession(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, existing.shop_email, ml.otp, ml.hashedToken);
          if (sessionTokens) return json({ success: true, access_token: sessionTokens.access_token, refresh_token: sessionTokens.refresh_token });
          return json({ success: true, redirect: await toBreakoutUrl(supabase, ml.link) });
        }
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

    // ── 4. Upsert the installation ───────────────────────────────────────────
    // Encrypt the token at rest. encryptToken() is FLAG-GATED — it stores plaintext
    // unless ENCRYPT_ACCESS_TOKENS=true, so this is safe to ship before flipping the
    // flag. Every consumer now calls decryptToken() (a no-op for plaintext), so once
    // all consumers are deployed the flag can be turned on. The table is also
    // RLS-locked to service_role (security C-01).
    const storedToken = await encryptToken(accessToken);

    // On re-open we refresh the token + activity only — never overwrite the original
    // installed_at, billing, or app_settings, and don't reset webhooks_registered.
    const installRow: Record<string, unknown> = {
      client_id: clientId, shop_domain: shop, myshopify_domain: shop,
      shop_name: storeName, shop_email: fallbackEmail,
      installation_status: "active",
      last_active_at: new Date().toISOString(),
      access_token: storedToken, shopify_access_token: storedToken,
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

    // ── 7. Generate magic link + OTP, issue session tokens, return to bootstrap ─
    const ml = await issueMagicLink(supabase, merchantEmail, merchantName, shop, clientId, appUrlHint);
    if (!ml) {
      // Install persisted; SSO link failed. Bootstrap falls back to manual login.
      return json({ success: true, redirect: null });
    }

    // Primary path: POST email_otp to /auth/v1/verify for JSON session tokens.
    // GoTrue returns tokens directly on POST — no redirect, no URL hash.
    // This is the only approach that works inside Shopify App Bridge (App Bridge
    // strips URL hashes when re-embedding navigations, breaking the hash-based flow).
    const sessionTokens = await exchangeOtpForSession(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      merchantEmail,
      ml.otp,
      ml.hashedToken,
    );
    if (sessionTokens) {
      console.log(`[token-exchange] direct session tokens issued for ${shop}`);
      return json({ success: true, access_token: sessionTokens.access_token, refresh_token: sessionTokens.refresh_token });
    }

    // Fallback: OTP exchange failed, magic link still unused → redirect approach.
    console.log(`[token-exchange] fallback to redirect for ${shop}`);
    return json({ success: true, redirect: await toBreakoutUrl(supabase, ml.link) });

  } catch (err: any) {
    console.error("[token-exchange] Unhandled error:", err?.message ?? err);
    return json({ success: false, error: "Internal server error" }, 500);
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Exchange an OTP for a Supabase session by POSTing to /auth/v1/verify.
 * GoTrue returns JSON tokens on POST — no redirect, no URL hash.
 * Tries token_hash (hashed_token from generateLink) first; if that fails or is
 * absent, falls back to email + email_otp. token_hash is more reliable across
 * GoTrue versions because some versions omit email_otp in the generateLink response.
 */
async function exchangeOtpForSession(
  supabaseUrl: string,
  supabaseAnonKey: string,
  email: string,
  emailOtp: string,
  hashedToken: string = "",
): Promise<{ access_token: string; refresh_token: string } | null> {
  if (!emailOtp && !hashedToken) {
    console.warn("[token-exchange] OTP exchange: both emailOtp and hashedToken are empty");
    return null;
  }

  const verify = async (body: Record<string, unknown>) => {
    const res = await fetchWithTimeout(`${supabaseUrl}/auth/v1/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": supabaseAnonKey },
      body: JSON.stringify(body),
    }, 8000);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[token-exchange] verify HTTP ${res.status}:`, errText.substring(0, 200));
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!data?.access_token) {
      console.warn("[token-exchange] verify: no access_token. keys:", Object.keys(data ?? {}).join(","));
      return null;
    }
    if (!data.refresh_token) {
      console.warn("[token-exchange] GoTrue verify: no refresh_token in response. Keys:", Object.keys(data ?? {}).join(","));
      return null;
    }
    return { access_token: data.access_token, refresh_token: data.refresh_token };
  };

  try {
    // Primary: token_hash approach — works across GoTrue versions, no email needed
    if (hashedToken) {
      const result = await verify({ token_hash: hashedToken, type: "magiclink" });
      if (result) { console.log("[token-exchange] session via token_hash"); return result; }
    }

    // Fallback: email + email_otp (raw OTP, GoTrue hashes it server-side)
    if (emailOtp) {
      const result = await verify({ email, token: emailOtp, type: "magiclink" });
      if (result) { console.log("[token-exchange] session via email_otp"); return result; }
    }

    return null;
  } catch (e: any) {
    console.error("[token-exchange] OTP exchange error:", e?.message);
    return null;
  }
}

/**
 * Convert a Supabase magic link into a one-time breakout URL.
 * Stores the magic link behind a single-use, 2-minute code; the bootstrap breaks
 * out to /shopify-sso-redirect?code=… which 302s to the magic link server-side.
 * The magic link (a credential) therefore never appears in our response body / JS.
 */
async function toBreakoutUrl(supabase: any, magicLink: string): Promise<string> {
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("sso_breakout_codes")
    .insert({ magic_link: magicLink, expires_at: expiresAt })
    .select("code")
    .single();
  if (error || !data?.code) {
    // Fallback: if the code table is unavailable, return the magic link directly
    // (degrades to prior behaviour rather than blocking the install).
    console.error("[token-exchange] breakout code insert failed:", error?.message);
    return magicLink;
  }
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/shopify-sso-redirect?code=${data.code}`;
}

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
): Promise<{ link: string; otp: string; hashedToken: string } | null> {
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

  const magicLink   = data?.properties?.action_link;
  const emailOtp    = data?.properties?.email_otp    ?? "";
  const hashedToken = data?.properties?.hashed_token ?? "";
  const userId      = data?.user?.id;
  if (!magicLink) return null;

  console.log(`[token-exchange] generateLink otp_len=${emailOtp.length} hash_len=${hashedToken.length}`);

  if (userId) {
    const { error: pErr } = await supabase.from("profiles").upsert(
      { id: userId, email, full_name: fullName, role: "client", client_id: clientId || null },
      { onConflict: "id", ignoreDuplicates: false },
    );
    if (pErr) console.error("[token-exchange] profile upsert:", pErr.message);
  }
  return { link: magicLink, otp: emailOtp, hashedToken };
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
