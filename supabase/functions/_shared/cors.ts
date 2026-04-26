/**
 * CORS configuration for GoSelf edge functions.
 *
 * Allowed origins:
 *  - app.goself.in        — production client portal
 *  - dev.app.goself.in    — development client portal
 *  - ai.goself.in         — production Shopify app URL
 *  - develop.ai.goself.in — development Shopify app URL
 *  - Shopify storefronts  — stored in ALLOWED_SHOPIFY_ORIGINS env var as
 *    a comma-separated list, e.g.:
 *    "https://yourstore.myshopify.com,https://anotherstore.myshopify.com"
 *
 * Set ALLOWED_SHOPIFY_ORIGINS as a Supabase edge function secret.
 * The fallback is the production dashboard origin.
 */

const DASHBOARD_ORIGIN = 'https://app.goself.in';

const ALWAYS_ALLOWED = [
  'https://app.goself.in',
  'https://dev.app.goself.in',
  'https://ai.goself.in',
  'https://develop.ai.goself.in',
];

function getAllowedOrigins(): string[] {
  const extra = Deno.env.get('ALLOWED_SHOPIFY_ORIGINS') || '';
  const shopifyOrigins = extra
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  return [...ALWAYS_ALLOWED, ...shopifyOrigins];
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
