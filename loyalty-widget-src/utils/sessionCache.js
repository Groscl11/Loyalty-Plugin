/**
 * sessionCache — GoSelf Loyalty Widget V6
 * Thin TTL cache over sessionStorage.
 *
 * M-07: All keys are scoped to the current shop domain to prevent cross-shop
 * cache contamination on shared-device / multi-store scenarios.
 * Call initShopScope(shopDomain) at widget initialisation before any cache ops.
 */

const TTL_MS = {
  customer_session: 15_000,   // Points balance: 15 seconds
  earning_rules:   60_000,   // Rules: 60 seconds
  partner_brands: 300_000,   // Partners: 5 minutes
  referral_stats:  30_000,   // Referrals: 30 seconds
  default:         15_000,   // Fallback: 15 seconds
};

// M-07: Module-level shop scope — set once at widget init via initShopScope()
let _shopScope = 'default';

/**
 * Must be called before any cache reads/writes.
 * Typically called in useCustomerData when the shop domain is resolved.
 */
export function initShopScope(shopDomain) {
  if (shopDomain && shopDomain !== _shopScope) {
    _shopScope = shopDomain.replace(/[^a-z0-9.-]/gi, '_');
  }
}

function storageKey(key) {
  // M-07: prefix with shop scope so different stores never share cache
  return `goself:${_shopScope}:${key}`;
}

function getTTL(key) {
  if (key.startsWith('customer_session')) return TTL_MS.customer_session;
  if (key.startsWith('earning_rules'))    return TTL_MS.earning_rules;
  if (key.startsWith('partner_brands'))   return TTL_MS.partner_brands;
  if (key.startsWith('referral_stats'))   return TTL_MS.referral_stats;
  return TTL_MS.default;
}

export function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > getTTL(key)) {
      sessionStorage.removeItem(storageKey(key));
      return null;
    }
    return data;
  } catch { return null; }
}

export function cacheSet(key, data) {
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify({ data, ts: Date.now() }));
  } catch { /* storage full — fail silently */ }
}

export function cacheClear(key) {
  try { sessionStorage.removeItem(storageKey(key)); } catch { /* ignore */ }
}

/**
 * Invalidate customer session cache when points-affecting actions occur.
 * NOTE: does NOT clear the widget token — it stays valid for its full 1-hour TTL.
 */
export function invalidateCustomerSession() {
  try {
    sessionStorage.removeItem(storageKey('customer_session'));
    sessionStorage.removeItem(storageKey('customer_session_v2'));
    sessionStorage.removeItem(storageKey('referral_stats'));
  } catch { /* ignore */ }
}

export function invalidateEarningRules() {
  try { sessionStorage.removeItem(storageKey('earning_rules')); } catch { /* ignore */ }
}

/**
 * Clear ALL GoSelf cache for this shop scope (logout / emergency reset).
 */
export function invalidateAllCache() {
  try {
    const prefix = `goself:${_shopScope}:`;
    Object.keys(sessionStorage)
      .filter(k => k.startsWith('goself:'))
      .forEach(k => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
}
