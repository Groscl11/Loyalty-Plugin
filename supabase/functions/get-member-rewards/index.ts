/**
 * get-member-rewards
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns all redeemable rewards for a loyalty member, grouped into three
 * categories so the loyalty widget can render a rich rewards panel.
 *
 * ── Request ──────────────────────────────────────────────────────────────────
 * GET  /get-member-rewards?shop=<shop_domain>&member_user_id=<uuid>
 * GET  /get-member-rewards?shop=<shop_domain>&email=<email>
 * POST /get-member-rewards  { shop_domain, member_user_id?, email? }
 *
 * ── Response ─────────────────────────────────────────────────────────────────
 * {
 *   points_balance : number,
 *
 *   discount_rewards : DiscountReward[],   // Shopify discount codes
 *   brand_rewards    : BrandReward[],      // Partner-brand vouchers
 *   manual_rewards   : ManualReward[],     // Fulfilled manually by merchant
 *
 *   existing_codes   : Record<reward_id, { code, expires_at }>
 *                      // discount codes already issued to this member
 * }
 *
 * Each reward has: can_redeem (bool) — true when points_balance >= points_cost
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Parse inputs ─────────────────────────────────────────────────────────
    let shopDomain: string | null = null;
    let memberUserId: string | null = null;
    let email: string | null = null;
    let clientId: string | null = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      shopDomain = url.searchParams.get("shop") ?? url.searchParams.get("shop_domain");
      memberUserId = url.searchParams.get("member_user_id");
      email = url.searchParams.get("email") ?? url.searchParams.get("customer_email");
      clientId = url.searchParams.get("client_id");
    } else {
      const body = await req.json().catch(() => ({}));
      shopDomain = body.shop_domain ?? body.shop ?? null;
      memberUserId = body.member_user_id ?? null;
      email = body.email ?? body.customer_email ?? null;
      clientId = body.client_id ?? null;
    }

    if (!shopDomain && !clientId) {
      return json({ error: "shop_domain or client_id is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 1. Resolve client_id from shop domain ─────────────────────────────────
    if (!clientId && shopDomain) {
      const { data: inst } = await supabase
        .from("store_installations")
        .select("client_id")
        .eq("shop_domain", shopDomain)
        .maybeSingle();

      clientId = inst?.client_id ?? null;

      if (!clientId) {
        const { data: intg } = await supabase
          .from("integration_configs")
          .select("client_id")
          .eq("shop_domain", shopDomain)
          .maybeSingle();
        clientId = intg?.client_id ?? null;
      }
    }

    if (!clientId) {
      return json({
        points_balance: 0,
        discount_rewards: [],
        brand_rewards: [],
        manual_rewards: [],
        existing_codes: {},
      });
    }

    // ── 2. Resolve member_user_id from email ──────────────────────────────────
    if (!memberUserId && email) {
      const q = supabase
        .from("member_users")
        .select("id")
        .eq("email", email);

      if (clientId) q.eq("client_id", clientId);

      const { data: mu } = await q.maybeSingle();
      memberUserId = mu?.id ?? null;
    }

    // ── 3. Fetch points balance ───────────────────────────────────────────────
    let pointsBalance = 0;

    if (memberUserId) {
      // member_loyalty_status has NO client_id column — query by member_user_id only
      const { data: sRows } = await supabase
        .from("member_loyalty_status")
        .select("points_balance")
        .eq("member_user_id", memberUserId)
        .order("points_balance", { ascending: false })
        .limit(1);
      pointsBalance = sRows?.[0]?.points_balance ?? 0;
    }


    // ── 4. Fetch distributions + rewards (flat — no nested client join) ─────────
    const { data: rawDistributions } = await supabase
      .from("offer_distributions")
      .select(`
        id,
        points_cost,
        access_type,
        max_per_member,
        offer:rewards(
          id, title, description, reward_type, offer_type, coupon_type,
          discount_value, min_purchase_amount, currency, terms_conditions,
          generic_coupon_code, available_codes, image_url, owner_client_id,
          status, is_active
        )
      `)
      .eq("distributing_client_id", clientId)
      .eq("is_active", true);

    const activeDistributions = (rawDistributions ?? []).filter((d: any) =>
      d.offer && d.offer.is_active === true && d.offer.status === "active"
    );

    // ── 4a. Fetch client logos for all owner_client_ids in one query ──────────
    const ownerClientIds = [
      ...new Set(
        activeDistributions
          .map((d: any) => d.offer.owner_client_id)
          .filter(Boolean)
      ),
    ] as string[];

    const clientLogoMap: Record<string, { logo_url: string | null; name: string | null }> = {};
    if (ownerClientIds.length > 0) {
      const { data: clientRows } = await supabase
        .from("clients")
        .select("id, logo_url, name")
        .in("id", ownerClientIds);
      for (const c of (clientRows ?? [])) {
        clientLogoMap[c.id] = { logo_url: c.logo_url ?? null, name: c.name ?? null };
      }
    }

    // Helper: resolve the best logo for a reward
    const resolveImage = (offer: any): string | null =>
      offer.image_url ?? clientLogoMap[offer.owner_client_id]?.logo_url ?? null;

    const discountRewards = activeDistributions
      .filter((d: any) =>
        d.offer.offer_type === "store_discount" ||
        d.offer.offer_type === "marketplace_offer"
      )
      .map((d: any) => ({
        id: d.offer.id,
        distribution_id: d.id,
        title: d.offer.title,
        description: d.offer.description,
        reward_type: d.offer.reward_type,
        offer_type: d.offer.offer_type,
        coupon_type: d.offer.coupon_type,
        discount_value: d.offer.discount_value,
        min_purchase_amount: d.offer.min_purchase_amount,
        generic_coupon_code: d.offer.generic_coupon_code,
        available_codes: d.offer.available_codes,
        image_url: resolveImage(d.offer),
        points_cost: d.points_cost,        // from offer_distributions, NOT rewards
        access_type: d.access_type,
        category: "discount",
        can_redeem: pointsBalance >= (d.points_cost ?? 0),
      }))
      .sort((a: any, b: any) => (a.points_cost ?? 0) - (b.points_cost ?? 0));

    // ── 5. Fetch brand rewards (partner vouchers) ─────────────────────────────
    const brandRewards = activeDistributions
      .filter((d: any) => d.offer.offer_type === "partner_voucher")
      .filter((d: any) => {
        if (d.offer.coupon_type === "generic" && d.offer.generic_coupon_code) return true;
        return (d.offer.available_codes ?? 0) > 0;
      })
      .map((d: any) => ({
        config_id: d.id,
        reward_id: d.offer.id,
        title: d.offer.title,
        description: d.offer.description,
        value_description: d.offer.description,
        image_url: resolveImage(d.offer),
        coupon_type: d.offer.coupon_type ?? "unique",
        generic_coupon_code: d.offer.coupon_type === "generic" ? d.offer.generic_coupon_code : null,
        brand_name: clientLogoMap[d.offer.owner_client_id]?.name ?? null,
        brand_logo: resolveImage(d.offer),
        brand_website_url: null,
        category: "partner",
        points_cost: d.points_cost,        // from offer_distributions
        access_type: d.access_type,
        can_redeem: pointsBalance >= (d.points_cost ?? 0),
        reward_type: "brand_voucher",
      }));

    // ── 6. Fetch manual rewards (via offer_distributions — points_cost is authoritative there) ──
    const manualRewards = activeDistributions
      .filter((d: any) => d.offer.reward_type === "manual")
      .map((d: any) => ({
        id: d.offer.id,
        distribution_id: d.id,
        title: d.offer.title,
        description: d.offer.description,
        terms_conditions: d.offer.terms_conditions,
        points_cost: d.points_cost,  // from offer_distributions
        category: "manual",
        reward_type: "manual",
        can_redeem: pointsBalance >= (d.points_cost ?? 0),
      }))
      .sort((a: any, b: any) => (a.points_cost ?? 0) - (b.points_cost ?? 0));

    // ── 7a. Existing issued brand vouchers for this member ────────────────────
    const existingBrandCodes: Record<string, { code: string; expires_at: string | null }> = {};

    if (memberUserId && brandRewards.length > 0) {
      const allBrandRewardIds = brandRewards.map((r: any) => r.reward_id);

      // Unique codes: check offer_codes table (replaces legacy vouchers table)
      const uniqueBrandIds = brandRewards.filter((r: any) => r.coupon_type !== "generic").map((r: any) => r.reward_id);
      if (uniqueBrandIds.length > 0) {
        const { data: bCodes } = await supabase
          .from("offer_codes")
          .select("offer_id, code, expires_at")
          .eq("assigned_to_member_id", memberUserId)
          .eq("status", "assigned")
          .in("offer_id", uniqueBrandIds);
        for (const c of (bCodes ?? [])) {
          if (c.offer_id && !existingBrandCodes[c.offer_id]) {
            existingBrandCodes[c.offer_id] = { code: c.code, expires_at: c.expires_at };
          }
        }
      }

      // Generic codes: check transaction history for prior redemptions
      const genericBrandIds = brandRewards.filter((r: any) => r.coupon_type === "generic").map((r: any) => r.reward_id);
      if (genericBrandIds.length > 0) {
        const { data: genTxns } = await supabase
          .from("loyalty_points_transactions")
          .select("reference_id, metadata")
          .eq("member_user_id", memberUserId)
          .eq("transaction_type", "redeemed")
          .in("reference_id", genericBrandIds)
          .order("created_at", { ascending: false });
        for (const txn of (genTxns ?? [])) {
          const codeFromMeta = txn.metadata?.code || txn.metadata?.voucher_code || txn.metadata?.discount_code || null;
          if (txn.reference_id && codeFromMeta && !existingBrandCodes[txn.reference_id]) {
            existingBrandCodes[txn.reference_id] = { code: codeFromMeta, expires_at: null };
          }
        }
      }
    }

    // ── 7. Existing unused discount codes for this member ─────────────────────
    const existingCodes: Record<string, { code: string; expires_at: string | null }> = {};

    if (memberUserId && discountRewards.length > 0) {
      const rewardIds = discountRewards.map((r: any) => r.id);

      // Check offer_codes first (new primary table)
      const { data: offerCodeRows } = await supabase
        .from("offer_codes")
        .select("offer_id, code, expires_at")
        .eq("assigned_to_member_id", memberUserId)
        .eq("status", "assigned")
        .in("offer_id", rewardIds);

      for (const c of (offerCodeRows ?? [])) {
        if (c.offer_id && !existingCodes[c.offer_id]) {
          existingCodes[c.offer_id] = { code: c.code, expires_at: c.expires_at };
        }
      }

      // Fallback: loyalty_discount_codes (old Shopify discount codes)
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

    // ── 8. Return ─────────────────────────────────────────────────────────────
    return json({
      points_balance: pointsBalance,
      discount_rewards: discountRewards,
      brand_rewards: brandRewards,
      manual_rewards: manualRewards,
      existing_codes: existingCodes,
      existing_brand_codes: existingBrandCodes,
    });
  } catch (err: any) {
    console.error("get-member-rewards error:", err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
