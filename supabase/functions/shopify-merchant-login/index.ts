/**
 * shopify-merchant-login — DEPRECATED for direct client use
 *
 * This endpoint is locked down with an internal service secret.
 * The SSO flow now uses:
 *   - shopify-oauth-callback  (install flow — magic link generated + redirected server-side)
 *   - shopify-session-login   (re-open flow — HMAC-verified, magic link redirected server-side)
 *
 * Kept deployed for any internal service-to-service calls that may still reference it.
 * Requires X-Internal-Secret header matching the INTERNAL_SSO_SECRET env var.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Internal-Secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // ── Internal secret gate ──────────────────────────────────────────────────
  // This endpoint must only be called by trusted internal services, never by
  // browser clients directly. Require a shared secret on every request.
  const internalSecret = Deno.env.get("INTERNAL_SSO_SECRET");
  if (!internalSecret) {
    // If secret is not configured, the endpoint is fully locked — fail closed.
    console.error("[merchant-login] INTERNAL_SSO_SECRET not set — endpoint disabled");
    return new Response(JSON.stringify({ error: "Endpoint disabled" }), {
      status: 503,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const providedSecret = req.headers.get("X-Internal-Secret");
  if (!providedSecret || providedSecret !== internalSecret) {
    console.warn("[merchant-login] Unauthorized call — invalid X-Internal-Secret");
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const { shop_domain, email, client_id, shop_name, shop_owner, redirect_to } = await req.json();

    if (!email || !shop_domain || !redirect_to) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Validate redirect_to is a known safe origin
    const allowedOrigins = [
      'https://app.goself.in',
      'https://dev.app.goself.in',
      ...(Deno.env.get('ALLOWED_APP_URLS') || '').split(',').filter(Boolean),
    ];
    try {
      const redirectOrigin = new URL(redirect_to).origin;
      if (!allowedOrigins.some(o => new URL(o).origin === redirectOrigin)) {
        console.error('[merchant-login] redirect_to origin not in allowlist:', redirectOrigin);
        return new Response(JSON.stringify({ error: "Invalid redirect_to" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    } catch {
      return new Response(JSON.stringify({ error: "Malformed redirect_to" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    console.log(`[merchant-login] Generating magic link for ${email} (shop: ${shop_domain})`);

    const tryGenerate = () => supabase.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: redirect_to } });
    let { data, error: linkError } = await tryGenerate();

    if (linkError) {
      const { error: createError } = await supabase.auth.admin.createUser({
        email, email_confirm: true,
        user_metadata: { shop_domain, shop_name, shop_owner, client_id },
      });
      if (createError && !createError.message.toLowerCase().includes('already')) throw createError;
      const retry = await tryGenerate();
      if (retry.error) throw retry.error;
      data = retry.data;
    }

    const userId    = data?.user?.id;
    const magicLink = data?.properties?.action_link;
    if (!magicLink) throw new Error('Failed to generate magic link');

    if (userId) {
      await supabase.from('profiles').upsert(
        { id: userId, email, full_name: shop_owner || shop_name || email.split('@')[0], role: 'client', client_id: client_id || null },
        { onConflict: 'id', ignoreDuplicates: false },
      ).catch((e: any) => console.error('[merchant-login] profile upsert:', e.message));
    }

    // M-01: Return a 302 redirect by default — magic link URL never exposed as JSON.
    // If the internal caller explicitly requests JSON (Accept: application/json),
    // return the redirect URL under a generic key so it isn't logged as a magic link.
    const wantsJson = (req.headers.get('Accept') || '').includes('application/json');
    if (wantsJson) {
      // Internal service-to-service: caller handles the redirect itself
      return new Response(JSON.stringify({ auth_redirect: magicLink, user_id: userId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    // Default: redirect directly — magic link stays server-side
    return new Response(null, {
      status: 302,
      headers: { 'Location': magicLink, ...corsHeaders },
    });
  } catch (error) {
    console.error("[merchant-login] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Login failed" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
