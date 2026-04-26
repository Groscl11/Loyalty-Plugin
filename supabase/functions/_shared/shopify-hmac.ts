/**
 * Shared Shopify HMAC verification utilities.
 *
 * Two distinct verification methods:
 *  - verifyWebhookHmac  — for incoming webhook POST bodies
 *    Uses SHOPIFY_WEBHOOK_SECRET (same for all merchants in a public app)
 *
 *  - verifyOAuthHmac    — for OAuth redirect query parameters
 *    Uses SHOPIFY_CLIENT_SECRET (your app's API secret key)
 */

/**
 * Verify a Shopify webhook request.
 * rawBody must be the raw string body read BEFORE JSON.parse.
 * hmacHeader is the value of X-Shopify-Hmac-Sha256.
 */
export async function verifyWebhookHmac(
  rawBody: string,
  hmacHeader: string
): Promise<boolean> {
  const secret = Deno.env.get('SHOPIFY_WEBHOOK_SECRET');
  if (!secret || !hmacHeader) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === hmacHeader;
}

/**
 * Verify the HMAC on a Shopify OAuth redirect.
 * params is the full URLSearchParams from the redirect URL.
 * Uses the app's CLIENT_SECRET (not the webhook secret).
 */
export async function verifyOAuthHmac(params: URLSearchParams): Promise<boolean> {
  const secret = Deno.env.get('SHOPIFY_CLIENT_SECRET');
  const hmac = params.get('hmac');
  if (!secret || !hmac) return false;

  // Message = all params except hmac, sorted alphabetically, joined with &
  const message = [...params.entries()]
    .filter(([k]) => k !== 'hmac')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return computed === hmac;
}
