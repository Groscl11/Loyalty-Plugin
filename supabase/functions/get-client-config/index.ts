import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * GET /get-client-config
 *
 * Returns the full plan + module + feature config for the authenticated client.
 * Called once on widget/dashboard init. Response is safe to cache for 5 minutes.
 *
 * Response shape:
 * {
 *   client_id: string,
 *   plan: { id, name, billing_cycle, status, amount_inr, current_period_end },
 *   modules: { loyalty: bool, campaigns: bool, referral: bool, network: bool },
 *   features: { [feature_key]: bool },
 *   trial_active: bool,
 *   trial_ends_at: string | null
 * }
 *
 * Feature resolution order (highest wins):
 *   1. client_feature_flags override (manual/trial/compensation)
 *   2. plan_feature_entitlements (what the plan includes)
 *   3. Default: false
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify JWT and get profile
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // Get client_id from profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("client_id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.client_id) return json({ error: "No client associated with this account" }, 404);

    const clientId = profile.client_id;

    // ── 1. Get subscription ───────────────────────────────────────────────────
    const { data: sub } = await supabase
      .from("client_subscriptions")
      .select("plan_id, status, billing_cycle, amount_inr, trial_ends_at, current_period_end")
      .eq("client_id", clientId)
      .maybeSingle();

    const planId = sub?.plan_id ?? "free";
    const subStatus = sub?.status ?? "active";
    const now = new Date();
    const trialActive = sub?.trial_ends_at ? new Date(sub.trial_ends_at) > now : false;

    // Suspended clients get free-tier only
    const effectivePlanId = subStatus === "suspended" ? "free" : planId;

    // ── 2. Get plan details ───────────────────────────────────────────────────
    const { data: plan } = await supabase
      .from("plans")
      .select("id, name, price_monthly, price_annual")
      .eq("id", effectivePlanId)
      .maybeSingle();

    // ── 3. Get plan module entitlements ──────────────────────────────────────
    const { data: moduleRows } = await supabase
      .from("plan_module_entitlements")
      .select("module")
      .eq("plan_id", effectivePlanId);

    const planModules = new Set((moduleRows ?? []).map((r: any) => r.module));

    // ── 4. Get plan feature entitlements ─────────────────────────────────────
    const { data: featureRows } = await supabase
      .from("plan_feature_entitlements")
      .select("feature")
      .eq("plan_id", effectivePlanId);

    const planFeatures = new Set((featureRows ?? []).map((r: any) => r.feature));

    // ── 5. Get client-level overrides ────────────────────────────────────────
    const { data: overrideRows } = await supabase
      .from("client_feature_flags")
      .select("feature, module, is_enabled, expires_at, source")
      .eq("client_id", clientId);

    // Apply overrides — expired overrides are ignored
    const overrides: Record<string, boolean> = {};
    for (const row of (overrideRows ?? [])) {
      const expired = row.expires_at && new Date(row.expires_at) < now;
      if (!expired) {
        overrides[row.feature] = row.is_enabled;
      }
    }

    // ── 6. Build all known features list ─────────────────────────────────────
    const ALL_FEATURES = [
      // Loyalty
      "loyalty.points_earn",
      "loyalty.points_balance",
      "loyalty.tiers",
      "loyalty.redemption",
      "loyalty.product_page_points",
      "loyalty.thankyou_page_points",
      "loyalty.member_widget",
      // Campaigns
      "campaigns.order_value_trigger",
      "campaigns.auto_enrollment",
      "campaigns.advanced_conditions",
      "campaigns.analytics",
      // Referral
      "referral.link_generation",
      "referral.tracking",
      "referral.tiered_commissions",
      "referral.affiliate_dashboard",
      // Network
      "network.cross_brand_vouchers",
      "network.brand_marketplace",
      "network.analytics",
      // Enterprise
      "enterprise.custom_branding",
      "enterprise.dedicated_support",
      "enterprise.api_access",
    ];

    // Resolve each feature: override wins, then plan entitlement, then false
    const features: Record<string, boolean> = {};
    for (const feature of ALL_FEATURES) {
      if (feature in overrides) {
        features[feature] = overrides[feature];
      } else {
        features[feature] = planFeatures.has(feature);
      }
    }

    // ── 7. Build modules map (derived from features + overrides) ─────────────
    // A module is active if the plan entitles it OR any of its features are enabled via override
    const moduleKeys = ["loyalty", "campaigns", "referral", "network"];
    const modules: Record<string, boolean> = {};
    for (const mod of moduleKeys) {
      const fromPlan = planModules.has(mod);
      const fromOverride = Object.entries(overrides).some(
        ([feat, enabled]) => feat.startsWith(`${mod}.`) && enabled
      );
      modules[mod] = fromPlan || fromOverride;
    }

    // ── 8. Build upgrade prompt hints ────────────────────────────────────────
    // Tells the frontend which plan to suggest when a locked feature is clicked
    const FEATURE_UPGRADE_HINT: Record<string, string> = {
      "loyalty.thankyou_page_points":  "starter",
      "campaigns.advanced_conditions": "growth",
      "campaigns.analytics":           "growth",
      "referral.link_generation":      "referral",
      "referral.tiered_commissions":   "referral",
      "referral.affiliate_dashboard":  "referral",
      "network.cross_brand_vouchers":  "network",
      "network.brand_marketplace":     "network",
      "network.analytics":             "network",
    };

    const locked_feature_hints: Record<string, string> = {};
    for (const [feat, suggestedPlan] of Object.entries(FEATURE_UPGRADE_HINT)) {
      if (!features[feat]) locked_feature_hints[feat] = suggestedPlan;
    }

    // ── Response ──────────────────────────────────────────────────────────────
    return json({
      client_id: clientId,
      plan: {
        id:                 effectivePlanId,
        name:               plan?.name ?? "Free",
        billing_cycle:      sub?.billing_cycle ?? "monthly",
        status:             subStatus,
        amount_inr:         sub?.amount_inr ?? 0,
        current_period_end: sub?.current_period_end ?? null,
        price_monthly:      plan?.price_monthly ?? 0,
        price_annual:       plan?.price_annual ?? 0,
      },
      modules,
      features,
      trial_active:   trialActive,
      trial_ends_at:  sub?.trial_ends_at ?? null,
      locked_feature_hints,  // { 'campaigns.analytics': 'growth' } → show "Upgrade to Growth"
      cache_seconds:  300,   // frontend may cache this response for 5 minutes
    }, 200);

  } catch (error: any) {
    console.error("get-client-config error:", error);
    return json({ error: "Internal server error", message: error.message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
