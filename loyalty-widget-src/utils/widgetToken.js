/**
 * widgetToken.js — C-01 fix
 *
 * Manages the short-lived HMAC-signed widget token issued by the
 * `issue-widget-token` edge function. The token proves the customer is
 * an enrolled loyalty member for this shop and must be sent as the
 * `X-Widget-Token` header on every authenticated API call.
 *
 * Token TTL: 60 minutes server-side. We refresh at 55 minutes to give
 * a 5-minute safety margin before the server rejects it.
 *
 * Storage: sessionStorage only (cleared on tab close; never persisted
 * to localStorage so it isn't accessible across tabs or after logout).
 */

const STORAGE_KEY  = 'goself:widget_token';
const REFRESH_MS   = 55 * 60 * 1000; // 55 minutes in ms

// ── Stored token shape ────────────────────────────────────────────────────────
// { token: string, expiresAt: number (unix ms), memberId: string, clientId: string }

export function getStoredToken() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Treat as expired 5 minutes before the server would reject it
    if (!parsed.token || Date.now() > parsed.expiresAt - 5 * 60 * 1000) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function storeToken(token, expiresAtIso, memberId, clientId) {
  try {
    const expiresAt = expiresAtIso
      ? new Date(expiresAtIso).getTime()
      : Date.now() + REFRESH_MS;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, expiresAt, memberId, clientId }));
  } catch { /* sessionStorage full — fail silently */ }
}

export function clearWidgetToken() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/**
 * Returns the current valid token string, or null if none/expired.
 * The caller is responsible for fetching a new one when this returns null.
 */
export function getWidgetToken() {
  const stored = getStoredToken();
  return stored ? stored.token : null;
}

/**
 * Fetch a fresh token from the server.
 * Called at widget init (for returning members) and after registration.
 *
 * Returns the token string on success, null on failure (non-member guest,
 * network error, etc.).
 */
export async function fetchWidgetToken(supabaseUrl, anonKey, email, shopDomain) {
  if (!email || !shopDomain || !supabaseUrl || !anonKey) return null;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/issue-widget-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ email, shop_domain: shopDomain }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null; // 404 = not yet enrolled, 500 = server err
    const data = await res.json();
    if (!data.token) return null;
    storeToken(data.token, data.expires_at, data.member_user_id, data.client_id);
    return data.token;
  } catch {
    return null;
  }
}

/**
 * Store a token received inline from register-loyalty-member response.
 * This avoids a second round-trip for newly enrolled members.
 */
export function storeTokenFromRegistration(data) {
  if (!data?.widget_token) return;
  storeToken(
    data.widget_token,
    null, // server's 60-min TTL; we default to REFRESH_MS above
    data.member?.id || data.member_user_id || null,
    null,
  );
}
