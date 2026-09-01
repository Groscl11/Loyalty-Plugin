/**
 * backfill-web-pixels — one-shot admin function to activate the
 * attribution-pixel Web Pixel extension for all existing active
 * installations (stores that installed before registerWebPixel existed
 * in shopify-oauth-callback). New installs get this automatically.
 *
 * Requires: ?secret=<REPAIR_SECRET> query param matching the env var
 * (reuses the same secret as repair-webhooks).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

const WEB_PIXEL_CREATE = `
  mutation webPixelCreate($webPixel: WebPixelInput!) {
    webPixelCreate(webPixel: $webPixel) {
      userErrors { field message }
      webPixel { id }
    }
  }
`;

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') || '';
  const repairSecret = Deno.env.get('REPAIR_SECRET') || '';

  if (!repairSecret || secret !== repairSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const clickEndpoint = Deno.env.get('CLICK_TRACKING_ENDPOINT')
    || `${Deno.env.get('SUPABASE_URL')}/functions/v1/track-utm-click`;

  // Optional filter: ?shop=xxx.myshopify.com to backfill just one store
  const shopFilter = url.searchParams.get('shop');

  let query = supabase
    .from('store_installations')
    .select('id, shop_domain, shopify_access_token, access_token')
    .eq('installation_status', 'active');
  if (shopFilter) query = query.eq('shop_domain', shopFilter);

  const { data: installations, error } = await query;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const results: any[] = [];

  for (const inst of (installations || [])) {
    const accessToken = inst.shopify_access_token || inst.access_token;
    if (!accessToken) {
      results.push({ shop: inst.shop_domain, status: 'skipped', reason: 'no access token' });
      continue;
    }

    try {
      const res = await fetchWithTimeout(`https://${inst.shop_domain}/admin/api/2025-01/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: WEB_PIXEL_CREATE,
          variables: { webPixel: { settings: { clickEndpoint } } },
        }),
      }, 8000);
      const json = await res.json();
      const pixelId = json?.data?.webPixelCreate?.webPixel?.id;
      const userErrors = json?.data?.webPixelCreate?.userErrors;

      if (pixelId) {
        results.push({ shop: inst.shop_domain, status: 'ok', pixelId });
      } else if (userErrors?.length) {
        // Common non-fatal case: pixel already exists for this shop
        results.push({ shop: inst.shop_domain, status: 'already_exists_or_error', userErrors });
      } else {
        results.push({ shop: inst.shop_domain, status: 'unknown', response: json });
      }
    } catch (e: any) {
      results.push({ shop: inst.shop_domain, status: 'error', error: e.message });
    }
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
