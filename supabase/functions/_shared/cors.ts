/**
 * CORS configuration for GoSelf edge functions.
 *
 * Allowed origins:
 *  - The GoSelf admin dashboard (Netlify)
 *  - Shopify storefronts — stored in ALLOWED_SHOPIFY_ORIGINS env var as
 *    a comma-separated list, e.g.:
 *    "https://yourstore.myshopify.com,https://anotherstore.myshopify.com"
 *
 * Set ALLOWED_SHOPIFY_ORIGINS as a Supabase edge function secret.
 * The fallback is the dashboard origin only.
 */

const DASHBOARD_ORIGIN = 'https://goself.netlify.app';

function getAllowedOrigins(): string[] {
  const extra = Deno.env.get('ALLOWED_SHOPIFY_ORIGINS') || '';
  const shopifyOrigins = extra
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  return [DASHBOARD_ORIGIN, ...shopifyOrigins];
}

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = getAllowedOrigins();
  const responseOrigin = origin && allowed.includes(origin) ? origin : DASHBOARD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': responseOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Admin-Secret',
    'Vary': 'Origin',
  };
}

/**
 * Legacy export kept for functions that haven't been updated yet.
 * Prefer getCorsHeaders(origin) for new code.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': DASHBOARD_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Admin-Secret',
  'Vary': 'Origin',
};
