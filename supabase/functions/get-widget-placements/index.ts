import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptToken } from "../_shared/token-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Extension UUID from shopify.extension.toml
const EXTENSION_UID = "63dc22e1-27da-358d-1f2a-1e6d9b60e4b66a03a917";

// All 11 known block slugs (filename without .liquid)
const KNOWN_BLOCKS = [
  "loyalty-widget",
  "loyalty-page",
  "cart-points",
  "cart-drawer-points",
  "product-points",
  "collection-points",
  "pre-purchase-homepage-hero",
  "pre-purchase-sticky-banner",
  "pre-purchase-collection-banner",
  "pre-purchase-product-strip",
  "refer-a-friend",
];

async function fetchAsset(shop: string, themeId: number, key: string, token: string): Promise<string> {
  const r = await fetch(
    `https://${shop}/admin/api/2024-01/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  if (!r.ok) return "";
  const d = await r.json();
  return d.asset?.value || "";
}

function detectBlocks(content: string, placedSet: Set<string>) {
  if (!content) return;

  for (const slug of KNOWN_BLOCKS) {
    // Most reliable: Shopify stores app blocks as
    // "shopify://apps/{handle}/blocks/{slug}/{uid}"
    // The /blocks/{slug}/ segment is unique to our extension regardless of handle or UID format.
    if (
      content.includes(`/blocks/${slug}/`) ||
      content.includes(`/blocks/${slug}"`) ||
      // Also match if the full UID happens to appear alongside the slug
      (content.includes(EXTENSION_UID) && content.includes(slug)) ||
      // Legacy / older section schema formats
      content.includes(`"loyalty-widget/${slug}"`) ||
      content.includes(`loyalty-widget/${slug}`) ||
      content.includes(`"type": "${slug}"`)
    ) {
      placedSet.add(slug);
    }
  }
}

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

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await supabase
      .from("profiles")
      .select("client_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.client_id) return json({ error: "No client associated" }, 404);

    const clientId = profile.client_id;

    const { data: installation } = await supabase
      .from("store_installations")
      .select("access_token, shop_domain")
      .eq("client_id", clientId)
      .eq("installation_status", "active")
      .maybeSingle();

    if (!installation?.access_token || !installation?.shop_domain) {
      return json({ connected: false, placed: [], cache_seconds: 300 });
    }

    const shop = installation.shop_domain;
    const token = await decryptToken(installation.access_token);

    // Step 1: Get active theme
    const themesRes = await fetch(
      `https://${shop}/admin/api/2024-01/themes.json?role=main`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (!themesRes.ok) {
      const errBody = await themesRes.text();
      console.error("Themes fetch failed:", themesRes.status, errBody);
      if (themesRes.status === 403 || themesRes.status === 401) {
        // read_themes scope not granted — return connected:true so the UI knows
        // the store is linked but can't read themes yet (re-auth required)
        return json({
          connected: true,
          placed: [],
          theme_name: null,
          scope_missing: true,
          cache_seconds: 60,
        });
      }
      return json({ connected: true, placed: [], theme_name: null, cache_seconds: 60 });
    }
    const themesData = await themesRes.json();
    const activeTheme = (themesData.themes || []).find((t: any) => t.role === "main");
    if (!activeTheme) {
      return json({ connected: true, placed: [], cache_seconds: 300 });
    }
    const themeId: number = activeTheme.id;

    // Step 2: List all assets
    const assetsRes = await fetch(
      `https://${shop}/admin/api/2024-01/themes/${themeId}/assets.json`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (!assetsRes.ok) {
      console.error("Assets list failed:", await assetsRes.text());
      return json({ error: "Failed to list theme assets" }, 502);
    }
    const allAssets: { key: string }[] = (await assetsRes.json()).assets || [];

    // Step 3: Identify assets to scan
    // - templates/*.json  → section/block placements per page template
    // - sections/*.json   → section-level block placements
    // - config/settings_data.json → app embed blocks (floating widgets, banners)
    const assetsToScan = allAssets.filter((a) =>
      (a.key.endsWith(".json") &&
        (a.key.startsWith("templates/") || a.key.startsWith("sections/"))) ||
      a.key === "config/settings_data.json"
    );

    // Step 4: Fetch each asset and detect block placements
    const placedSet = new Set<string>();

    await Promise.all(
      assetsToScan.map(async (asset) => {
        try {
          const content = await fetchAsset(shop, themeId, asset.key, token);
          detectBlocks(content, placedSet);
        } catch {
          // skip asset errors silently
        }
      })
    );

    return json({
      connected: true,
      placed: Array.from(placedSet),
      theme_name: activeTheme.name,
      cache_seconds: 300,
    });
  } catch (error: any) {
    console.error("get-widget-placements error:", error);
    return json({ error: "Internal server error", message: error.message }, 500);
  }
});
