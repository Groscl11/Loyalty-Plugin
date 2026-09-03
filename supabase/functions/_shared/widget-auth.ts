/**
 * widget-auth.ts — C-01 fix
 *
 * Short-lived HMAC-signed widget tokens for all customer-facing endpoints.
 *
 * Token format:  <base64url(JSON payload)>.<hex HMAC-SHA256>
 * Payload:       { mid: member_user_id, cid: client_id, exp: unix_seconds }
 *
 * Secret:        WIDGET_TOKEN_SECRET env var (must be set in Supabase edge secrets)
 * TTL:           60 minutes
 *
 * Usage (issue):
 *   const token = await issueWidgetToken(memberId, clientId);
 *
 * Usage (verify — in every protected endpoint):
 *   const claims = await verifyWidgetToken(req);
 *   if (!claims) return json({ error: 'Unauthorized' }, 401);
 *   // use claims.mid and claims.cid — do NOT trust body values
 */

export const WIDGET_TOKEN_TTL = 60 * 60; // 1 hour in seconds

export interface WidgetTokenClaims {
  mid: string; // member_user_id
  cid: string; // client_id
  exp: number; // unix timestamp
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function b64uEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(str: string): string {
  // Restore standard base64 padding
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return atob(pad ? padded + '='.repeat(4 - pad) : padded);
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time hex string comparison — prevents timing oracle attacks */
function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Issue a signed widget token scoped to a specific member + client.
 * Called by issue-widget-token and register-loyalty-member (on successful registration).
 */
export async function issueWidgetToken(memberId: string, clientId: string): Promise<string> {
  const secret = Deno.env.get('WIDGET_TOKEN_SECRET');
  if (!secret) throw new Error('WIDGET_TOKEN_SECRET not configured');

  const exp = Math.floor(Date.now() / 1000) + WIDGET_TOKEN_TTL;
  const payload: WidgetTokenClaims = { mid: memberId, cid: clientId, exp };
  const payloadB64 = b64uEncode(JSON.stringify(payload));
  const sig = await hmacHex(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a widget token from the X-Widget-Token request header.
 * Returns the decoded claims on success, or null if missing / invalid / expired.
 *
 * IMPORTANT: always use claims.mid and claims.cid for identity —
 * never trust email or member_user_id values from the request body.
 */
export async function verifyWidgetToken(req: Request): Promise<WidgetTokenClaims | null> {
  const token = req.headers.get('X-Widget-Token');
  if (!token) return null;

  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 1) return null;

  const payloadB64 = token.substring(0, dotIdx);
  const receivedSig = token.substring(dotIdx + 1);

  // Decode and parse payload
  let payload: WidgetTokenClaims;
  try {
    payload = JSON.parse(b64uDecode(payloadB64)) as WidgetTokenClaims;
  } catch {
    return null;
  }

  // Check expiry first (cheap)
  if (!payload.exp || !payload.mid || !payload.cid) return null;
  if (Math.floor(Date.now() / 1000) > payload.exp) return null;

  // Verify HMAC (constant-time)
  const secret = Deno.env.get('WIDGET_TOKEN_SECRET');
  if (!secret) return null;

  const expectedSig = await hmacHex(secret, payloadB64);
  if (!timingSafeHexEqual(receivedSig, expectedSig)) return null;

  return payload;
}
