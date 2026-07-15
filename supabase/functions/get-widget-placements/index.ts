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

// Extension handle as defined in shopify.extension.toml
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

    // Verify JWT and get client_id
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

    // Get active store installation for this client
    const { data: installation } = await supabase
      .from("store_installations")
      .select("access_token, shop_domain")
      .eq("client_id", clientId)
      .eq("installation_status", "active")
      .maybeSingle();

    if (!installation?.access_token || !installation?.shop_domain) {
      // No Shopify store connected — all blocks are unplaced
      return json({
        connected: false,
        placed: [],
        cache_seconds: 300,
      });
    }

    const shop = installation.shop_domain;
    const token = await decryptToken(installation.access_token);

    // Step 1: Get active theme ID
    const themesRes = await fetch(
      `https://${shop}/admin/api/2024-01/themes.json?role=main`,
      { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } }
    );
    if (!themesRes.ok) {
      console.error("Themes fetch failed:", await themesRes.text());
      return json({ error: "Failed to fetch Shopify themes" }, 502);
    }
    const themesData = await themesRes.json();
    const activeTheme = (themesData.themes || []).find((t: any) => t.role === "main");
    if (!activeTheme) {
      return json({ connected: true, placed: [], cache_seconds: 300 });
    }
    const themeId = activeTheme.id;

    // Step 2: List all assets to find template JSON files
    const assetsRes = await fetch(
      `https://${shop}/admin/api/2024-01/themes/${themeId}/assets.json`,
      { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } }
    );
    if (!assetsRes.ok) {
      console.error("Assets list failed:", await assetsRes.text());
      return json({ error: "Failed to list theme assets" }, 502);
    }
    const assetsData = await assetsRes.json();
    const allAssets: { key: string }[] = assetsData.assets || [];

    // Filter to section and template JSON files that could contain extension blocks
    const jsonAssets = allAssets.filter((a) =>
      a.key.endsWith(".json") &&
      (a.key.startsWith("templates/") || a.key.startsWith("sections/"))
    );

    // Step 3: Fetch each JSON file and scan for our extension block references
    // Block type string in Shopify JSON: "shopify://apps/{handle}/blocks/{block-slug}/{uid}"
    // or as type: "loyalty-widget/{block-slug}" in older section schema
    // We search for the UID prefix which is unique to our extension
    const placedSet = new Set<string>();

    await Promise.all(
      jsonAssets.map(async (asset) => {
        try {
          const r = await fetch(
            `https://${shop}/admin/api/2024-01/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(asset.key)}`,
            { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } }
          );
          if (!r.ok) return;
          const d = await r.json();
          const content: string = d.asset?.value || "";
          if (!content.includes(EXTENSION_UID)) return;

          // Find which specific blocks are placed
          for (const blockSlug of KNOWN_BLOCKS) {
            if (content.includes(`${EXTENSION_UID}/${blockSlug}`) || content.includes(`"${blockSlug}"`)) {
              // More precise: check for the UID with block slug
              if (content.includes(EXTENSION_UID) && content.includes(blockSlug)) {
                placedSet.add(blockSlug);
              }
            }
          }
        } catch {
          // skip individual asset errors
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
