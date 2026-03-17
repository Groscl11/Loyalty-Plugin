/**
 * get-rewards-catalog
 * GET /get-rewards-catalog?shop=<shop_domain>&member_user_id=<uuid>
 *
 * Returns:
 *   rewards        — active rewards for the store's client
 *   existing_codes — map of reward_id → { code, expires_at } for unused codes
 *                    already held by this member
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const shopDomain = url.searchParams.get("shop") || url.searchParams.get("shop_domain");
    const memberUserId = url.searchParams.get("member_user_id");

    if (!shopDomain) {
      return new Response(
        JSON.stringify({ error: "shop parameter is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── 1. Resolve client_id from shop domain ──────────────────────────────
    // Try store_installations first, then integration_configs
    let clientId: string | null = null;

    const { data: installation } = await supabase
      .from("store_installations")
      .select("client_id")
      .eq("shop_domain", shopDomain)
      .maybeSingle();

    if (installation?.client_id) {
      clientId = installation.client_id;
    } else {
      const { data: integration } = await supabase
        .from("integration_configs")
        .select("client_id")
        .eq("shop_domain", shopDomain)
        .maybeSingle();
      clientId = integration?.client_id ?? null;
    }

    if (!clientId) {
      return new Response(
        JSON.stringify({ rewards: [], existing_codes: {} }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Fetch active rewards ─────────────────────────────────────────────
    const { data: rewards } = await supabase
      .from("rewards")
      .select("id, title, description, reward_type, discount_value, points_cost, min_purchase_amount, currency, terms_conditions")
      .eq("client_id", clientId)
      .eq("is_active", true)
      .order("points_cost", { ascending: true });

    if (!rewards || rewards.length === 0) {
      return new Response(
        JSON.stringify({ rewards: [], existing_codes: {} }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 3. Fetch existing unused codes for this member ──────────────────────
    const existingCodes: Record<string, { code: string; expires_at: string | null }> = {};

    if (memberUserId) {
      const rewardIds = rewards.map((r: any) => r.id);

      const { data: codes } = await supabase
        .from("loyalty_discount_codes")
        .select("reward_id, code, expires_at")
        .eq("member_id", memberUserId)
        .eq("is_used", false)
        .in("reward_id", rewardIds);

      if (codes) {
        for (const c of codes) {
          if (c.reward_id && !existingCodes[c.reward_id]) {
            existingCodes[c.reward_id] = { code: c.code, expires_at: c.expires_at };
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ rewards, existing_codes: existingCodes }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("get-rewards-catalog error:", error);
    return new Response(
      JSON.stringify({ error: error.message ?? "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
