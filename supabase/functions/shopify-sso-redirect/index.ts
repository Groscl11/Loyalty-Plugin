/**
 * shopify-sso-redirect — one-time-code → magic-link server-side 302.
 *
 * The embedded install bootstrap breaks out (top-frame navigation) to:
 *   /functions/v1/shopify-sso-redirect?code=<uuid>
 * We validate the single-use, short-TTL code and 302 to the Supabase magic link
 * SERVER-SIDE. The magic link (a credential) is in the Location header only — never
 * in a response body or client JS (enterprise: no credentials in response bodies).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const FALLBACK_LOGIN =
  (Deno.env.get("APP_URL") || Deno.env.get("DASHBOARD_URL") || "https://app.goself.in") + "/login?from=shopify";

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  // Basic UUID shape check before touching the DB.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)) {
    return redirect(FALLBACK_LOGIN);
  }
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Atomically claim the code: flip used=false → true and return the row only if it
    // was still unused AND unexpired. Prevents replay / double-use.
    const { data, error } = await supabase
      .from("sso_breakout_codes")
      .update({ used: true })
      .eq("code", code)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .select("magic_link")
      .maybeSingle();
    if (error || !data?.magic_link) {
      console.warn("[sso-redirect] invalid/expired/used code");
      return redirect(FALLBACK_LOGIN);
    }
    return redirect(data.magic_link);
  } catch (err) {
    console.error("[sso-redirect] error:", (err as any)?.message ?? err);
    return redirect(FALLBACK_LOGIN);
  }
});
