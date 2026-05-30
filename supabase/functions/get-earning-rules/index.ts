import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const shopDomain    = url.searchParams.get("shop_domain") || "";
    const memberUserId  = url.searchParams.get("member_user_id") || "";

    if (!shopDomain) return json({ error: "shop_domain is required" }, 400);

    // ── 1. Resolve client_id from shop_domain ─────────────────────────────────
    let clientId: string | null = null;

    const { data: ic } = await supabase
      .from("integration_configs")
      .select("client_id")
      .eq("shop_domain", shopDomain)
      .maybeSingle();
    if (ic?.client_id) clientId = ic.client_id;

    if (!clientId) {
      const { data: si } = await supabase
        .from("store_installations")
        .select("client_id")
        .eq("shop_domain", shopDomain)
        .eq("installation_status", "active")
        .maybeSingle();
      if (si?.client_id) clientId = si.client_id;
    }

    if (!clientId) return json({ error: "Shop not found", rules: [] }, 200);

    // ── 2. Fetch active earning rules for this client ─────────────────────────
    const { data: rules, error: rulesErr } = await supabase
      .from("loyalty_earning_rules")
      .select(
        "id, rule_type, name, description, points_reward, " +
        "referral_discount_type, referral_discount_value, referral_min_order_value, " +
        "social_platform, social_url, " +
        "max_times_per_customer, cooldown_days, " +
        "is_active"
      )
      .eq("client_id", clientId)
      .eq("is_active", true)
      .order("rule_type");

    if (rulesErr) {
      console.error("Rules fetch error:", rulesErr);
      return json({ error: "Failed to fetch earning rules" }, 500);
    }

    if (!rules || rules.length === 0) {
      return json({ client_id: clientId, rules: [] });
    }

    // ── 3. If member_user_id provided, check which rules member already completed ──
    let completedRuleIds = new Set<string>();

    if (memberUserId) {
      // Fetch all earn/bonus transactions for this member so we can check per-rule limits
      const { data: txns } = await supabase
        .from('loyalty_points_transactions')
        .select('metadata')
        .eq('member_user_id', memberUserId)
        .in('transaction_type', ['earned', 'bonus']);

      if (txns) {
        for (const txn of txns) {
          const ruleId = txn.metadata?.rule_id;
          if (ruleId) completedRuleIds.add(ruleId);
        }
      }

      // Also check member profile fields for date-based and profile_complete rules
      const { data: memberProfile } = await supabase
        .from("member_users")
        .select("date_of_birth, anniversary_date, full_name, phone")
        .eq("id", memberUserId)
        .maybeSingle();

      const profile = memberProfile || {};
      // Profile is considered complete when name + phone + birthday are set.
      // Anniversary is a separate earn action and is no longer required here.
      const profileIsComplete = !!(
        (profile as any).full_name?.trim() &&
        (profile as any).phone?.trim() &&
        (profile as any).date_of_birth
      );

      const enriched = rules.map((rule: any) => {
        const timesEarned = txns
          ? txns.filter((t: any) => t.metadata?.rule_id === rule.id).length
          : 0;

        const maxTimes = rule.max_times_per_customer;

        // For profile_complete: use direct field-presence check so the widget
        // correctly shows "✓ Claimed" even when the transaction INSERT failed
        // (the balance update still succeeded, member genuinely completed profile).
        let isCompleted: boolean;
        if (rule.rule_type === "profile_complete") {
          isCompleted = profileIsComplete;
        } else {
          isCompleted = maxTimes !== null && timesEarned >= maxTimes;
        }

        let extra: Record<string, unknown> = {};
        if (rule.rule_type === "birthday") {
          extra.saved_value = (profile as any).date_of_birth || null;
        }
        if (rule.rule_type === "anniversary") {
          extra.saved_value = (profile as any).anniversary_date || null;
        }

        return {
          ...rule,
          times_earned: timesEarned,
          is_completed: isCompleted,
          ...extra,
        };
      });

      return json({ client_id: clientId, rules: enriched });
    }

    // No member — return rules without completion status
    return json({
      client_id: clientId,
      rules: rules.map((r: any) => ({ ...r, times_earned: 0, is_completed: false })),
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Unhandled error in get-earning-rules:", message);
    return json({ error: message }, 500);
  }
});
