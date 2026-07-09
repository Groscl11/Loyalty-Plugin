/**
 * Shared Shopify HMAC verification utilities.
 *
 * Two distinct verification methods:
 *  - verifyWebhookHmac  — for incoming webhook POST bodies (base64 output)
 *    Uses SHOPIFY_WEBHOOK_SECRET (same for all merchants in a public app)
 *
 *  - verifyOAuthHmac    — for OAuth redirect query parameters (hex output)
 *    Uses SHOPIFY_CLIENT_SECRET (your app's API secret key)
 *
 * C-11: All comparisons use timingSafeEqual (constant-time XOR loop) to
 * prevent timing oracle attacks where an attacker infers the correct HMAC
 * by measuring response latency.
 */

/**
 * Constant-time string equality — prevents timing side-channel attacks.
 * Both strings must be the same length; if not, returns false immediately
 * (length difference is not secret information for Shopify HMACs).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify a Shopify webhook request.
 * rawBody must be the raw string body read BEFORE JSON.parse.
 * hmacHeader is the value of X-Shopify-Hmac-Sha256 (base64-encoded).
 */
export async function verifyWebhookHmac(
  rawBody: string,
  hmacHeader: string
): Promise<boolean> {
  // Public-app webhooks are signed with the app's API secret. Prefer a dedicated
  // SHOPIFY_WEBHOOK_SECRET when set, else fall back to SHOPIFY_API_SECRET.
  const secret = Deno.env.get('SHOPIFY_WEBHOOK_SECRET') || Deno.env.get('SHOPIFY_API_SECRET');
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
  return timingSafeEqual(computed, hmacHeader); // C-11: constant-time
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
  return timingSafeEqual(computed, hmac); // C-11: constant-time
}
