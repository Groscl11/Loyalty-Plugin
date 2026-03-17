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

    // ── 4. Fetch discount rewards (Shopify-backed) ────────────────────────────
    const { data: rawDiscount } = await supabase
      .from("rewards")
      .select(
        "id, title, description, reward_type, discount_value, points_cost, " +
        "min_purchase_amount, currency, terms_conditions"
      )
      .eq("client_id", clientId)
      .eq("is_active", true)
      .order("points_cost", { ascending: true });

    const discountRewards = (rawDiscount ?? [])
      .filter((r: any) => r.reward_type !== "manual" && r.reward_type !== "brand_voucher")
      .map((r: any) => ({
      ...r,
      category: "discount",
      can_redeem: pointsBalance >= r.points_cost,
    }));

    // ── 5. Fetch brand rewards (marketplace, configured by client) ────────────
    const { data: rawBrand } = await supabase
      .from("client_brand_reward_configs")
      .select(
        "id, points_cost, note, " +
        "reward:rewards!reward_id(" +
          "id, title, description, value_description, voucher_count, coupon_type, generic_coupon_code, " +
          "category, expiry_date, image_url, terms_conditions, " +
          "brands!brand_id(id, name, logo_url, website_url)" +
        ")"
      )
      .eq("client_id", clientId)
      .eq("is_active", true);

    // Count live available (unassigned) vouchers per reward (only needed for unique-code rewards)
    const brandRewardIds = (rawBrand ?? [])
      .map((cfg: any) => cfg.reward?.id)
      .filter((id: any) => {
        const cfg = (rawBrand ?? []).find((c: any) => c.reward?.id === id);
        return cfg?.reward?.coupon_type !== "generic";
      });

    let availableVoucherCounts: Record<string, number> = {};
    if (brandRewardIds.length > 0) {
      const { data: vRows } = await supabase
        .from("vouchers")
        .select("reward_id")
        .in("reward_id", brandRewardIds)
        .is("member_id", null)
        .eq("status", "available");

      for (const v of (vRows ?? [])) {
        availableVoucherCounts[v.reward_id] = (availableVoucherCounts[v.reward_id] ?? 0) + 1;
      }
    }

    const brandRewards = (rawBrand ?? [])
      .filter((cfg: any) => {
        if (!cfg.reward) return false;
        // Generic code rewards are always available (same code given to everyone)
        if (cfg.reward.coupon_type === "generic") return !!cfg.reward.generic_coupon_code;
        // Unique code rewards need available vouchers in the pool
        return (availableVoucherCounts[cfg.reward.id] ?? 0) > 0;
      })
      .map((cfg: any) => ({
        config_id: cfg.id,
        reward_id: cfg.reward.id,
        title: cfg.reward.title,
        description: cfg.reward.description,
        value_description: cfg.reward.value_description,
        image_url: cfg.reward.image_url ?? null,
        terms_conditions: cfg.reward.terms_conditions ?? null,
        expiry_date: cfg.reward.expiry_date ?? null,
        voucher_count: cfg.reward.voucher_count,
        brand_name: cfg.reward.brands?.name ?? null,
        brand_logo: cfg.reward.brands?.logo_url ?? null,
        brand_website_url: cfg.reward.brands?.website_url ?? null,
        category: cfg.reward.category ?? "brand",
        coupon_type: cfg.reward.coupon_type ?? "unique",
        generic_coupon_code: cfg.reward.coupon_type === "generic" ? cfg.reward.generic_coupon_code : null,
        points_cost: cfg.points_cost,
        note: cfg.note ?? null,
        can_redeem: pointsBalance >= cfg.points_cost,
        reward_type: "brand_voucher",
      }));

    // ── 6. Fetch manual rewards ───────────────────────────────────────────────
    const { data: rawManual } = await supabase
      .from("rewards")
      .select(
        "id, title, description, points_cost, terms_conditions"
      )
      .eq("client_id", clientId)
      .eq("reward_type", "manual")
      .eq("is_active", true)
      .order("points_cost", { ascending: true });

    const manualRewards = (rawManual ?? []).map((r: any) => ({
      ...r,
      category: "manual",
      reward_type: "manual",
      can_redeem: pointsBalance >= r.points_cost,
    }));

    // ── 7a. Existing issued brand vouchers for this member ────────────────────
    const existingBrandCodes: Record<string, { code: string; expires_at: string | null }> = {};

    if (memberUserId && brandRewards.length > 0) {
      const allBrandRewardIds = brandRewards.map((r: any) => r.reward_id);

      // Unique codes: check vouchers table
      const uniqueBrandIds = brandRewards.filter((r: any) => r.coupon_type !== "generic").map((r: any) => r.reward_id);
      if (uniqueBrandIds.length > 0) {
        const { data: bVouchers } = await supabase
          .from("vouchers")
          .select("reward_id, code, expires_at")
          .eq("member_id", memberUserId)
          .eq("status", "available")
          .in("reward_id", uniqueBrandIds);
        for (const v of (bVouchers ?? [])) {
          if (v.reward_id && !existingBrandCodes[v.reward_id]) {
            existingBrandCodes[v.reward_id] = { code: v.code, expires_at: v.expires_at };
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
          if (txn.reference_id && txn.metadata?.voucher_code && !existingBrandCodes[txn.reference_id]) {
            existingBrandCodes[txn.reference_id] = { code: txn.metadata.voucher_code, expires_at: null };
          }
        }
      }
    }

    // ── 7. Existing unused discount codes for this member ─────────────────────
    const existingCodes: Record<string, { code: string; expires_at: string | null }> = {};

    if (memberUserId && discountRewards.length > 0) {
      const rewardIds = discountRewards.map((r: any) => r.id);

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
