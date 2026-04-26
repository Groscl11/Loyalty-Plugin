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

    // ── 2. Fetch active distributions with reward details ───────────────────
    // points_cost lives in offer_distributions, not rewards
    const { data: rawDists } = await supabase
      .from("offer_distributions")
      .select(`
        id,
        points_cost,
        access_type,
        offer:rewards(
          id, title, description, reward_type, offer_type, coupon_type,
          discount_value, min_purchase_amount, currency, terms_conditions,
          generic_coupon_code, available_codes, is_active
        )
      `)
      .eq("distributing_client_id", clientId)
      .eq("is_active", true);

    const activeDists = (rawDists ?? []).filter(
      (d: any) => d.offer && d.offer.is_active === true
    );

    if (activeDists.length === 0) {
      return new Response(
        JSON.stringify({ rewards: [], existing_codes: {} }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rewards = activeDists.map((d: any) => ({
      id: d.offer.id,
      distribution_id: d.id,
      title: d.offer.title,
      description: d.offer.description,
      reward_type: d.offer.reward_type,
      offer_type: d.offer.offer_type,
      coupon_type: d.offer.coupon_type,
      discount_value: d.offer.discount_value,
      min_purchase_amount: d.offer.min_purchase_amount,
      currency: d.offer.currency,
      terms_conditions: d.offer.terms_conditions,
      generic_coupon_code: d.offer.coupon_type === "generic" ? d.offer.generic_coupon_code : null,
      available_codes: d.offer.available_codes,
      points_cost: d.points_cost,  // from offer_distributions, NOT rewards
      access_type: d.access_type,
    })).sort((a: any, b: any) => (a.points_cost ?? 0) - (b.points_cost ?? 0));

    // ── 3. Fetch existing unused codes for this member ──────────────────────
    const existingCodes: Record<string, { code: string; expires_at: string | null }> = {};

    if (memberUserId) {
      const rewardIds = rewards.map((r: any) => r.id);

      // Check offer_codes first (primary table)
      const { data: offerCodes } = await supabase
        .from("offer_codes")
        .select("offer_id, code, expires_at")
        .eq("assigned_to_member_id", memberUserId)
        .eq("status", "assigned")
        .in("offer_id", rewardIds);

      for (const c of (offerCodes ?? [])) {
        if (c.offer_id && !existingCodes[c.offer_id]) {
          existingCodes[c.offer_id] = { code: c.code, expires_at: c.expires_at };
        }
      }

      // Fallback: loyalty_discount_codes (Shopify-generated codes)
      const missingIds = rewardIds.filter((id: string) => !existingCodes[id]);
      if (missingIds.length > 0) {
        const { data: ldcRows } = await supabase
          .from("loyalty_discount_codes")
          .select("reward_id, code, expires_at")
          .eq("member_id", memberUserId)
          .eq("is_used", false)
          .in("reward_id", missingIds);

        for (const c of (ldcRows ?? [])) {
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
