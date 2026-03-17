/**
 * sessionCache — GoSelf Loyalty Widget V6
 * Thin TTL cache over sessionStorage.
 * 
 * CACHE TTL STRATEGY (industry best practices):
 * - Customer session (points): 15 seconds (critical freshness)
 * - Earning rules: 60 seconds
 * - Partner data: 300 seconds (5 min)
 * 
 * Reduced from 60s to 15s following Sephora/Amazon pattern
 * for loyalty points to appear within 15 seconds of purchase.
 */

const TTL_MS = {
  customer_session: 15_000,      // Points balance: 15 seconds
  earning_rules: 60_000,         // Rules: 60 seconds
  partner_brands: 300_000,       // Partners: 5 minutes  
  referral_stats: 30_000,        // Referrals: 30 seconds
  default: 15_000                // Fallback: 15 seconds
};

// Get TTL for specific key type
function getTTL(key) {
  if (key.startsWith('customer_session')) return TTL_MS.customer_session;
  if (key.startsWith('earning_rules')) return TTL_MS.earning_rules;
  if (key.startsWith('partner_brands')) return TTL_MS.partner_brands;
  if (key.startsWith('referral_stats')) return TTL_MS.referral_stats;
  return TTL_MS.default;
}

export function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(`goself:${key}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    const ttl = getTTL(key);
    if (Date.now() - ts > ttl) {
      sessionStorage.removeItem(`goself:${key}`);
      return null;
    }
    return data;
  } catch { return null; }
}

export function cacheSet(key, data) {
  try {
    sessionStorage.setItem(
      `goself:${key}`,
      JSON.stringify({ data, ts: Date.now() })
    );
  } catch { /* storage full — fail silently */ }
}

export function cacheClear(key) {
  try { sessionStorage.removeItem(`goself:${key}`); } catch { /* ignore */ }
}

/**
 * Invalidate customer session cache when points-affecting actions occur.
 * Called after: order placed, profile updated, survey submitted, referral accepted, etc.
 * 
 * Industry pattern: Sephora, Amazon invalidate points cache on transaction completion.
 */
export function invalidateCustomerSession() {
  try {
    sessionStorage.removeItem('goself:customer_session');
    // Also clear related data that depends on session
    sessionStorage.removeItem('goself:referral_stats');
  } catch { /* ignore */ }
}

/**
 * Invalidate earning rules cache when membership changes.
 * Called after: member tier update, new rules released, etc.
 */
export function invalidateEarningRules() {
  try {
    sessionStorage.removeItem('goself:earning_rules');
  } catch { /* ignore */ }
}

/**
 * Clear ALL GoSelf cache (emergency/logout).
 */
export function invalidateAllCache() {
  try {
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith('goself:')) sessionStorage.removeItem(key);
    });
  } catch { /* ignore */ }
}
