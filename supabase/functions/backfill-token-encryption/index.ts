/**
 * backfill-token-encryption — one-shot admin job.
 *
 * After ENCRYPT_ACCESS_TOKENS=true is set, run this once to encrypt the
 * access tokens of EXISTING store_installations rows (new writes are already
 * encrypted by token-exchange / oauth-callback). Idempotent: rows already
 * prefixed "enc:v1:" are skipped, and encryptToken() is a no-op while the flag
 * is off (so running it early does nothing).
 *
 * Auth: requires header  X-Backfill-Secret: <BACKFILL_SECRET env>.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { encryptToken } from "../_shared/token-crypto.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("BACKFILL_SECRET") || "";
  if (!secret || req.headers.get("X-Backfill-Secret") !== secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Only rows whose token is NOT already encrypted.
  const { data: rows, error } = await supabase
    .from("store_installations")
    .select("id, access_token, shopify_access_token")
    .not("access_token", "like", "enc:v1:%");

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });

  let encrypted = 0, skipped = 0, failed = 0;
  for (const row of rows || []) {
    try {
      const at = row.access_token ? await encryptToken(row.access_token) : row.access_token;
      const sat = row.shopify_access_token ? await encryptToken(row.shopify_access_token) : row.shopify_access_token;
      // encryptToken is flag-gated: if it returned the same plaintext, the flag is
      // off — nothing to do (don't write).
      if (at === row.access_token && sat === row.shopify_access_token) { skipped++; continue; }
      const { error: upErr } = await supabase
        .from("store_installations")
        .update({ access_token: at, shopify_access_token: sat })
        .eq("id", row.id);
      if (upErr) { failed++; console.error("[backfill] update failed:", upErr.message); }
      else encrypted++;
    } catch (e) {
      failed++;
      console.error("[backfill] row error:", (e as any)?.message ?? e);
    }
  }

  return new Response(
    JSON.stringify({ success: true, total: rows?.length ?? 0, encrypted, skipped, failed }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
