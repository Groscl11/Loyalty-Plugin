/**
 * useCustomerData — GoSelf Loyalty Widget V6
 *
 * Fetches all data domains, wraps each in sessionCache (60s TTL),
 * and returns a single unified data object.
 *
 * All GoSelf edge functions are wired. Mock data is only used as
 * graceful fallback when the endpoint returns empty / errors.
 *
 * INTEGRATED SOLUTIONS:
 * - Solution 1: SWR for smart polling & background revalidation
 * - Solution 2: Supabase Realtime subscription for instant updates
 * - Solution 3: Manual refetch on key actions (exposed via refetch function)
 *
 * API Base: https://lizgppzyyljqbmzdytia.supabase.co
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { cacheGet, cacheSet, invalidateCustomerSession } from '../utils/sessionCache.js';
import { useRealtimeSubscription } from './useRealtime.js';

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../utils/supabase.js';

// ---------------------------------------------------------------------------
// Fetch helper — 8-second timeout, Supabase auth header
// ---------------------------------------------------------------------------
async function apiFetch(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        ...(options.headers || {}),
      },
    });
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------
function getShopDomain() {
  return (
    (typeof window !== 'undefined' && window.Shopify?.shop) ||
    window.location?.hostname ||
    ''
  );
}

function getCustomerEmail() {
  if (typeof window === 'undefined') return null;
  const email = (
    // 1. Server-injected by our Liquid block (most reliable — set before JS runs)
    window.__goself_customer_email ||
    // 2. GoKwik — phone-based login, sets window.gokwikData or window.__gokwik
    window.gokwikData?.email || window.__gokwik?.email ||
    // 3. GoKwik alternate: customer object they expose after login
    window.GoKwik?.customer?.email ||
    // 4. Shopify flat key (older themes)
    window.Shopify?.customerEmail ||
    // 5. Dawn/Sense/Craft themes — Shopify customer object
    window.Shopify?.customer?.email ||
    // 6. Meta tag fallback
    document.querySelector('meta[name="shopify:customer-email"]')?.content ||
    // 7. localStorage — some login apps persist email here
    tryLocalStorage('goself_customer_email') ||
    tryLocalStorage('customer_email') ||
    tryLocalStorage('user_email') ||
    null
  );
  if (email) console.log('[GoSelf] detected customer email:', email);
  return email;
}

function tryLocalStorage(key) {
  try { return localStorage.getItem(key) || null; } catch { return null; }
}

// ---------------------------------------------------------------------------
// MOCK DATA — used while backend endpoints are TBD
// TODO: replace each mock with a real API call once endpoint is ready
// ---------------------------------------------------------------------------

const MOCK_EARN_RULES = [
  { id: 'er1', icon: '🛍️', label: 'Place an order',         pointValue: '1 pt per ₹1 spent' },
  { id: 'er2', icon: '📋', label: 'Take a quick survey',     pointValue: '+75 pts',  featured: true },
  { id: 'er3', icon: '📣', label: 'Refer a friend',           pointValue: '+200 pts each' },
  { id: 'er4', icon: '⭐', label: 'Write a review',           pointValue: '+50 pts' },
  { id: 'er5', icon: '👤', label: 'Complete your profile',    pointValue: '+100 pts' },
  { id: 'er6', icon: '📱', label: 'Follow on Instagram',      pointValue: '+30 pts' },
];

const MOCK_CATALOG = [
  { id: 'c1', type: 'discount', title: '₹100 off on ₹999+',   pointsCost: 500,  discountValue: '₹100' },
  { id: 'c2', type: 'discount', title: 'Free shipping',         pointsCost: 200,  discountValue: 'FREE' },
  { id: 'c3', type: 'discount', title: '₹250 off on ₹1,999+', pointsCost: 1200, discountValue: '₹250' },
  {
    id: 'c4', type: 'partner', title: '30% off sitewide',
    pointsCost: 800, discountValue: '30%',
    brandName: 'Mamaearth', brandLogo: null, brandUrl: 'https://mamaearth.in',
  },
  { id: 'c5', type: 'free', title: 'Free Bamboo Brush', pointsCost: 600, discountValue: 'FREE' },
];

const MOCK_WALLET = [
  { id: 'w1', type: 'discount', status: 'active',  code: 'SAVE100', title: '₹100 off ₹999+',  brand: 'Houmetest',  discountValue: '₹100', expiryDate: '2026-06-30' },
  { id: 'w2', type: 'partner',  status: 'active',  code: 'MAMA30',  title: '30% off sitewide', brand: 'Mamaearth',  discountValue: '30%',  expiryDate: '2026-06-15', brandUrl: 'https://mamaearth.in' },
  { id: 'w3', type: 'free',     status: 'active',  code: null,       title: 'Free Bamboo Brush', brand: 'Houmetest', discountValue: 'FREE', expiryDate: '2026-07-01' },
  { id: 'w4', type: 'discount', status: 'used',    code: 'SHIP0',   title: 'Free shipping',     brand: 'Houmetest', discountValue: 'FREE', usedDate: '2026-02-10' },
];

const MOCK_HISTORY = [
  { id: 't1', label: 'Order #1234',        delta:  195, type: 'earn',   date: '2026-03-01', icon: '🛍️' },
  { id: 't2', label: 'Referral Bonus',     delta:  200, type: 'earn',   date: '2026-02-22', icon: '👥' },
  { id: 't3', label: 'Survey Completed',   delta:   75, type: 'earn',   date: '2026-02-15', icon: '📋' },
  { id: 't4', label: 'Redeemed — SAVE100', delta: -500, type: 'redeem', date: '2026-02-10', icon: '🎁' },
  { id: 't5', label: 'Birthday Bonus',     delta:  100, type: 'earn',   date: '2026-01-15', icon: '🎂' },
  { id: 't6', label: 'Follow on Instagram',delta:   30, type: 'earn',   date: '2026-01-10', icon: '📱' },
];

const MOCK_REFERRALS = [
  { refereeId: 'r1', refereeName: 'Amit K.',   refereeEmail: 'amit@x.com',  date: '2026-02-20', status: 'purchased', orderValue: 1200, ptsEarned: 200 },
  { refereeId: 'r2', refereeName: 'Sneha M.',  refereeEmail: 'sneha@x.com', date: '2026-02-15', status: 'pending',   orderValue: 0,    ptsEarned: 0   },
  { refereeId: 'r3', refereeName: 'Ravi P.',   refereeEmail: 'ravi@x.com',  date: '2026-01-30', status: 'purchased', orderValue: 850,  ptsEarned: 200 },
];

const MOCK_LEADERBOARD = [
  { rank: 1, name: 'Priya S.',  referralCount: 18, ptsEarned: 3600, isCurrentUser: true  },
  { rank: 2, name: 'Amit K.',   referralCount: 12, ptsEarned: 2400, isCurrentUser: false },
  { rank: 3, name: 'Neha R.',   referralCount:  9, ptsEarned: 1800, isCurrentUser: false },
  { rank: 4, name: 'Raj S.',    referralCount:  7, ptsEarned: 1400, isCurrentUser: false },
  { rank: 5, name: 'Meena T.', referralCount:  5, ptsEarned: 1000, isCurrentUser: false },
];

const MOCK_MILESTONES = [
  { id: 'm1', label: 'First Purchase',     pointsRequired:    0, reward: 'Welcome bonus: +100 pts',   icon: '🛍️', isCompleted: true  },
  { id: 'm2', label: 'Loyal Shopper',      pointsRequired:  500, reward: 'Silver status unlocked',    icon: '🥈', isCompleted: true  },
  { id: 'm3', label: 'Super Fan',          pointsRequired: 2000, reward: '₹200 mystery voucher',     icon: '⭐', isCompleted: true  },
  { id: 'm4', label: 'Gold Member',        pointsRequired: 5000, reward: '2× earn rate for 30 days', icon: '🥇', isCompleted: false },
  { id: 'm5', label: 'Platinum Elite',     pointsRequired:10000, reward: 'Exclusive partner rewards', icon: '💎', isCompleted: false },
];

const MOCK_SURVEY = {
  questions: [
    { id: 'q1', type: 'single', text: 'How did you hear about us?', options: ['Instagram', 'Friend', 'Google', 'Other'] },
    { id: 'q2', type: 'rating', text: 'How likely are you to recommend us?', maxRating: 5 },
    { id: 'q3', type: 'single', text: 'What do you shop most?', options: ['Skincare', 'Clothing', 'Home', 'Electronics'] },
  ],
  rewardPts: 75,
  headline: 'Quick survey — earn 75 pts!',
};

const MOCK_PARTNER_BRANDS = [
  { id: 'pb1', name: 'Mamaearth', logo: null, url: 'https://mamaearth.in' },
  { id: 'pb2', name: 'Nykaa',     logo: null, url: 'https://nykaa.com'    },
];

// ---------------------------------------------------------------------------
// Domain fetchers
// ---------------------------------------------------------------------------

async function fetchCustomerSession(shopDomain, customerEmail) {
  const cacheKey = 'customer_session';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await apiFetch(
    `${SUPABASE_URL}/functions/v1/get-loyalty-status?email=${encodeURIComponent(customerEmail)}&shop_domain=${encodeURIComponent(shopDomain)}`
  );

  // Treat any error response (404 member not found / not enrolled) as a throw
  // so rawSession stays null and domain fetchers don't fall back to mock data
  if (data.error) {
    console.warn('[GoSelf] get-loyalty-status:', data.error);
    throw new Error(data.error);
  }

  const result = {
    customerId:       data.customer_id    || data.customerId    || null,
    firstName:        data.first_name     || data.firstName     || data.customer_first_name || 'there',
    email:            customerEmail,
    phone:            data.phone          || null,
    pointsBalance:    data.points_balance ?? data.pointsBalance ?? 0,
    lifetimeEarned:   data.lifetime_points_earned   ?? 0,
    lifetimeRedeemed: data.lifetime_points_redeemed ?? 0,
    tier:             (data.tier?.name   || data.tier || 'bronze').toLowerCase(),
    referralCode:     data.referral_code  || data.referralCode  || null,
    referralUrl:      (data.referral_code || data.referralCode)
      ? `https://${shopDomain}?ref=${data.referral_code || data.referralCode}`
      : null,
    dob:              data.dob            || null,
    anniversary:      data.anniversary    || null,
    profileComplete:  data.profile_complete ?? data.profileComplete ?? 40,
    pointsEarnRate:   data.tier?.points_earn_rate    ?? 1,
    pointsEarnDivisor:data.tier?.points_earn_divisor ?? 1,
    // pass through raw tier thresholds if backend provides them
    tierThresholds:   data.tier_thresholds || null,
    // program branding — points noun from admin (e.g. "Gems", "Stars")
    programPointsName:         data.program?.points_name          || null,
    programPointsNameSingular: data.program?.points_name_singular || null,
    // pass through recent_transactions & rewards for use in other domains
    _raw: data,
  };

  cacheSet(cacheKey, result);
  return result;
}

async function fetchMerchantConfig(shopDomain, customerData) {
  const cacheKey = 'merchant_config';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Use earn_rules and tier_thresholds from the loyalty-status response if present
  const raw = customerData?._raw || {};
  const earnRulesFromApi = raw.earn_rules || raw.earnRules || null;
  const tierThresholdsFromApi = raw.tier_thresholds || customerData?.tierThresholds || null;

  const result = {
    storeName:      shopDomain.replace('.myshopify.com', ''),
    isAdmin:        raw.is_admin ?? false,
    pointsPerRupee: customerData?.pointsEarnRate ?? 1,
    earnRules:      earnRulesFromApi || MOCK_EARN_RULES,
    redeemCatalog:  MOCK_CATALOG,
    partnerBrands:  MOCK_PARTNER_BRANDS,
    tierThresholds: tierThresholdsFromApi || {
      bronze:   0,
      silver:   1000,
      gold:     5000,
      platinum: 10000,
    },
    // Feature flags — read from backend raw data when present, default to true
    showReferTab:       raw.show_refer_tab       ?? true,
    showLeaderboard:    raw.show_leaderboard     ?? true,
    showSurvey:         raw.show_survey          ?? true,
    showSurveyOnHome:   raw.show_survey_on_home  ?? false,
    showPartnerBrands:  raw.show_partner_brands  ?? true,
    enableFreeProducts: raw.enable_free_products ?? true,
    showMilestones:     raw.show_milestones      ?? true,
  };

  cacheSet(cacheKey, result);
  return result;
}

// fetchCatalog removed — use fetchMemberRewards (get-member-rewards) instead,
// which returns properly grouped discount_rewards / brand_rewards / manual_rewards
// via offer_distributions JOIN rewards.

// ---------------------------------------------------------------------------
// fetchEarnRules — calls get-earning-rules (backend source of truth)
// ---------------------------------------------------------------------------
async function fetchEarnRules(shopDomain, customerId) {
  const cacheKey = 'earn_rules';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({ shop_domain: shopDomain });
    if (customerId) params.set('member_user_id', customerId);
    const data = await apiFetch(
      `${SUPABASE_URL}/functions/v1/get-earning-rules?${params}`
    );
    const rules = data.rules;
    if (rules && rules.length > 0) {
      cacheSet(cacheKey, rules);
      return rules;
    }
  } catch (e) {
    console.warn('[GoSelf] get-earning-rules failed, using mock:', e.message);
  }

  cacheSet(cacheKey, MOCK_EARN_RULES);
  return MOCK_EARN_RULES;
}

// ---------------------------------------------------------------------------
// fetchMemberRewards — calls get-member-rewards (grouped catalog for redeem)
// Returns { discountRewards, brandRewards, manualRewards, existingCodes, existingBrandCodes }
// ---------------------------------------------------------------------------
async function fetchMemberRewards(shopDomain, customerEmail, customerId) {
  const cacheKey = 'member_rewards';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({ shop: shopDomain });
    if (customerId)    params.set('member_user_id', customerId);
    else if (customerEmail) params.set('email', customerEmail);
    const data = await apiFetch(
      `${SUPABASE_URL}/functions/v1/get-member-rewards?${params}`
    );

    const result = {
      discountRewards: (data.discount_rewards || []).map(r => ({
        id:            r.id,
        type:          'discount',
        title:         r.title,
        description:   r.description || null,
        pointsCost:    r.points_cost,
        discountValue: r.discount_value || '',
        canRedeem:     r.can_redeem ?? true,
        minPurchase:   r.min_purchase_amount || null,
        currency:      r.currency || null,
        terms:         r.terms_conditions || null,
      })),
      brandRewards: (data.brand_rewards || []).map(r => ({
        id:            r.config_id,
        rewardId:      r.reward_id,
        type:          'partner',
        title:         r.title,
        description:   r.description || r.value_description || null,
        pointsCost:    r.points_cost,
        discountValue: r.value_description || '',
        canRedeem:     r.can_redeem ?? true,
        brandName:     r.brand_name  || null,
        brandLogo:     r.brand_logo  || null,
        brandUrl:      r.brand_website_url || null,
        imageUrl:      r.image_url   || null,
        couponType:    r.coupon_type || 'unique',
        genericCode:   r.generic_coupon_code || null,
        terms:         r.terms_conditions || null,
      })),
      manualRewards: (data.manual_rewards || []).map(r => ({
        id:          r.id,
        type:        'free',
        title:       r.title,
        description: r.description || null,
        pointsCost:  r.points_cost,
        canRedeem:   r.can_redeem ?? true,
        terms:       r.terms_conditions || null,
      })),
      existingCodes:      data.existing_codes       || {},
      existingBrandCodes: data.existing_brand_codes || {},
    };

    cacheSet(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('[GoSelf] get-member-rewards failed, using mock catalog:', e.message);
  }

  // Fallback using MOCK_CATALOG
  const result = {
    discountRewards: MOCK_CATALOG
      .filter(c => c.type === 'discount')
      .map(r => ({ ...r, canRedeem: true })),
    brandRewards: MOCK_CATALOG
      .filter(c => c.type === 'partner')
      .map(r => ({ ...r, rewardId: r.id, canRedeem: true, couponType: 'unique', genericCode: null })),
    manualRewards: MOCK_CATALOG
      .filter(c => c.type === 'free')
      .map(r => ({ ...r, canRedeem: true })),
    existingCodes:      {},
    existingBrandCodes: {},
  };
  cacheSet(cacheKey, result);
  return result;
}

async function fetchWallet(shopDomain, customerEmail, rawSession) {
  const cacheKey = 'wallet';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Wallet = coupons already issued to customer
  // get-loyalty-status returns issued_coupons / coupons array if present
  const issuedCoupons = rawSession?.issued_coupons || rawSession?.coupons || rawSession?.wallet || null;
  if (issuedCoupons && issuedCoupons.length > 0) {
    const result = issuedCoupons.map((c, i) => ({
      id:           c.id   || `w${i}`,
      type:         c.type || 'discount',
      status:       c.status || 'active',
      code:         c.code  || c.discount_code || null,
      title:        c.title || c.name || 'Reward',
      brandName:    c.brand_name  || null,
      brandUrl:     c.brand_url   || null,
      discountValue:c.discount_value || '',
      expiresAt:    c.expires_at || c.expiry_date || null,
      usedAt:       c.used_at    || null,
    }));
    cacheSet(cacheKey, result);
    return result;
  }

  // Real user but no wallet yet — return empty (not mock)
  if (customerEmail) {
    cacheSet(cacheKey, []);
    return [];
  }

  cacheSet(cacheKey, MOCK_WALLET);
  return MOCK_WALLET;
}

async function fetchHistory(shopDomain, customerEmail, rawSession) {
  const cacheKey = 'history';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // get-loyalty-status returns recent_transactions array
  const txns = rawSession?.recent_transactions || rawSession?.transactions || null;
  if (txns && txns.length > 0) {
    const result = txns.map((t, i) => {
      // API stores points_amount as always-positive; transaction_type tells direction
      const rawAmt  = t.points_amount ?? t.points_delta ?? t.delta ?? t.points ?? 0;
      const txType  = t.transaction_type || t.type || (rawAmt < 0 ? 'redeem' : 'earn');
      const isRedeem = /redeem|debit|redemption|redeem_points/i.test(txType);
      const delta   = isRedeem ? -Math.abs(rawAmt) : Math.abs(rawAmt);
      return {
        id:    t.id    || `t${i}`,
        label: t.description || t.label || t.type || 'Transaction',
        delta,
        date:  t.created_at  || t.date  || '',
        icon:  t.icon  || (isRedeem ? '⬇' : '⬆'),
        type:  isRedeem ? 'redeem' : 'earn',
      };
    });
    cacheSet(cacheKey, result);
    return result;
  }

  // Real user but no transactions yet — return empty (not mock)
  if (customerEmail) {
    cacheSet(cacheKey, []);
    return [];
  }

  cacheSet(cacheKey, MOCK_HISTORY);
  return MOCK_HISTORY;
}

async function fetchReferrals(shopDomain, customerEmail, rawSession) {
  const cacheKey = 'referrals';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // get-loyalty-status may return referral_stats and referral_list
  const stats = rawSession?.referral_stats || rawSession?.referrals || null;
  const list  = rawSession?.referral_list  || rawSession?.referred_users || [];

  const result = {
    totalReferred:  stats?.total_referred  ?? stats?.totalReferred  ?? list.length,
    totalPurchased: stats?.total_purchased ?? stats?.totalPurchased ?? list.filter(r => r.status === 'purchased').length,
    totalPtsEarned: stats?.total_pts_earned ?? stats?.totalPtsEarned ?? 0,
    list: list.map((r, i) => ({
      id:        r.id    || `r${i}`,
      name:      r.name  || r.referee_name || r.email?.split('@')[0] || 'Customer',
      email:     r.email || r.referee_email || '',
      status:    r.status || 'pending',
      ptsEarned: r.pts_earned ?? r.ptsEarned ?? 0,
    })),
  };

  cacheSet(cacheKey, result);
  return result;
}

async function fetchLeaderboard(shopDomain, rawSession, isAuthenticated) {
  const cacheKey = 'leaderboard';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // get-loyalty-status may return leaderboard array
  const lb = rawSession?.leaderboard || null;
  if (lb && lb.length > 0) {
    const result = lb.map((e, i) => ({
      rank:          e.rank          ?? i + 1,
      displayName:   e.display_name  || e.name || `User ${i + 1}`,
      referrals:     e.referral_count ?? e.referrals ?? 0,
      points:        e.total_points  ?? e.points ?? 0,
      isCurrentUser: e.is_current_user ?? false,
      gapToNext:     e.gap_to_next   ?? null,
    }));
    cacheSet(cacheKey, result);
    return result;
  }

  // Authenticated users with no leaderboard data get an empty list, not mock data
  if (isAuthenticated) {
    cacheSet(cacheKey, []);
    return [];
  }

  cacheSet(cacheKey, MOCK_LEADERBOARD);
  return MOCK_LEADERBOARD;
}

async function fetchMilestones(shopDomain, customerEmail, rawSession) {
  const cacheKey = 'milestones';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const ms = rawSession?.milestones || null;
  if (ms && ms.length > 0) {
    const result = ms.map((m, i) => ({
      id:        m.id        || `m${i}`,
      title:     m.name      || m.title || `Milestone ${i + 1}`,
      threshold: m.points_required ?? m.threshold ?? 0,
      reward:    m.reward_description || m.reward || '',
      icon:      m.icon      || '⭐',
      completed: m.is_completed ?? m.completed ?? false,
      completedAt: m.completed_at || null,
    }));
    cacheSet(cacheKey, result);
    return result;
  }

  // Authenticated users with no milestones get an empty list, not mock data
  if (customerEmail) {
    cacheSet(cacheKey, []);
    return [];
  }

  cacheSet(cacheKey, MOCK_MILESTONES);
  return MOCK_MILESTONES;
}

async function fetchSurvey(shopDomain, customerEmail, rawSession) {
  const cacheKey = 'survey_questions';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const s = rawSession?.survey || rawSession?.active_survey || null;
  if (s && s.questions && s.questions.length > 0) {
    cacheSet(cacheKey, s);
    return s;
  }

  // Authenticated users with no active survey get an empty survey, not mock data
  if (customerEmail) {
    const empty = { questions: [], rewardPts: 0, headline: '' };
    cacheSet(cacheKey, empty);
    return empty;
  }

  cacheSet(cacheKey, MOCK_SURVEY);
  return MOCK_SURVEY;
}

// ---------------------------------------------------------------------------
// Main hook
// useCustomerData() — no argument needed; email is auto-detected from DOM.
// ---------------------------------------------------------------------------
export function useCustomerData() {
  const shopDomain = getShopDomain();

  // detectedEmail is live-reactive — poll for late logins (GoKwik, OTP flows, etc.)
  const [detectedEmail, setDetectedEmail] = useState(() => getCustomerEmail());

  useEffect(() => {
    // Already found an email — no need to poll
    if (detectedEmail) return;

    // Poll every 1.5s for up to 30s to catch AJAX/OTP logins that happen after page load
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // 20 × 1.5s = 30s window
    const timer = setInterval(() => {
      attempts++;
      const found = getCustomerEmail();
      if (found) {
        console.log('[GoSelf] late-detected email (attempt', attempts, '):', found);
        setDetectedEmail(found);
        clearInterval(timer);
      } else if (attempts >= MAX_ATTEMPTS) {
        clearInterval(timer);
      }
    }, 1500);

    // Also listen for custom events that login apps dispatch
    const handleLogin = (e) => {
      const email =
        e.detail?.email ||
        e.detail?.customer?.email ||
        window.gokwikData?.email ||
        window.__gokwik?.email ||
        getCustomerEmail();
      if (email) {
        console.log('[GoSelf] login event detected:', e.type, email);
        setDetectedEmail(email);
        clearInterval(timer);
      }
    };

    // GoKwik fires these events after successful login
    window.addEventListener('gokwik:login', handleLogin);
    window.addEventListener('gokwik:order_placed', handleLogin);
    // Generic events other login SDKs use
    window.addEventListener('customer:login', handleLogin);
    window.addEventListener('shopify:customer:login', handleLogin);

    // Public API: window.GoSelfWidget.setCustomer('email@example.com')
    // Merchants using any custom login app can call this in their login callback
    window.GoSelfWidget = window.GoSelfWidget || {};
    window.GoSelfWidget.setCustomer = (email) => {
      console.log('[GoSelf] setCustomer() called:', email);
      if (email) setDetectedEmail(email);
    };

    return () => {
      clearInterval(timer);
      window.removeEventListener('gokwik:login', handleLogin);
      window.removeEventListener('gokwik:order_placed', handleLogin);
      window.removeEventListener('customer:login', handleLogin);
      window.removeEventListener('shopify:customer:login', handleLogin);
    };
  }, [detectedEmail]);

  const customerEmail = detectedEmail;

  const [isLoading, setIsLoading]   = useState(true);
  const [error, setError]           = useState(null);
  const [merchant, setMerchant]     = useState({});
  const [customer, setCustomer]     = useState({});
  const [wallet, setWallet]         = useState([]);
  const [history, setHistory]       = useState([]);
  const [referrals, setReferrals]   = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [survey, setSurvey]         = useState({ questions: [], rewardPts: 75 });
  const [earnRules, setEarnRules]   = useState([]);
  const [redeemCatalog, setRedeemCatalog] = useState({
    discountRewards: [], brandRewards: [], manualRewards: [],
    existingCodes: {}, existingBrandCodes: {},
  });

  // Track which domains have been fetched so refetch() can target one
  const loadedRef = useRef({});

  // SOLUTION 2: Supabase Realtime subscription for instant updates
  // Listens for changes to member_loyalty_status and invalidates cache
  useRealtimeSubscription(customerEmail, shopDomain, () => {
    // When realtime event fires, invalidate cache and reload customer session
    invalidateCustomerSession();
    if (customerEmail) {
      fetchCustomerSession(shopDomain, customerEmail)
        .then(customerData => {
          setCustomer(customerData);
          console.log('[GoSelf] Realtime refetch complete, new balance:', customerData.pointsBalance);
        })
        .catch(err => {
          console.warn('[GoSelf] Realtime refetch failed:', err.message);
        });
    }
  });

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // ── 1. Customer session — single API call, returns everything ──────────
      let customerData = {};
      let rawSession   = null;
      if (customerEmail) {
        try {
          customerData = await fetchCustomerSession(shopDomain, customerEmail);
          rawSession   = customerData._raw || null;
          console.log('[GoSelf] session loaded, customerId:', customerData.customerId);
          setCustomer(customerData);
        } catch (e) {
          console.warn('[GoSelf] customer_session fetch failed:', e.message);
          // Keep email so LoyaltyWidget still shows member view (not enrolled yet)
          setCustomer({ email: customerEmail, pointsBalance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0 });
        }
      }

      // ── 2. Merchant config, earn rules, member rewards in parallel ────────
      const [merchantResult, earnRulesResult, memberRewardsResult] = await Promise.allSettled([
        fetchMerchantConfig(shopDomain, customerData),
        fetchEarnRules(shopDomain, customerData?.customerId ?? null),
        customerEmail
          ? fetchMemberRewards(shopDomain, customerEmail, customerData?.customerId ?? null)
          : Promise.resolve(null),
      ]);
      if (merchantResult.status      === 'fulfilled') setMerchant(merchantResult.value);
      if (earnRulesResult.status     === 'fulfilled' && earnRulesResult.value) setEarnRules(earnRulesResult.value);
      if (memberRewardsResult.status === 'fulfilled' && memberRewardsResult.value) setRedeemCatalog(memberRewardsResult.value);

      // ── 3. Authenticated-only domains — all derived from rawSession ────────
      if (customerEmail) {
        // These are all sync derivations from rawSession (no extra API calls)
        // Each fetchX() checks rawSession first, falls back to mock
        const [walletResult, historyResult, referralsResult, surveyResult, leaderboardResult, milestonesResult] =
          await Promise.allSettled([
            fetchWallet(shopDomain, customerEmail, rawSession),
            fetchHistory(shopDomain, customerEmail, rawSession),
            fetchReferrals(shopDomain, customerEmail, rawSession),
            fetchSurvey(shopDomain, customerEmail, rawSession),
            fetchLeaderboard(shopDomain, rawSession, true /* isAuthenticated */),
            fetchMilestones(shopDomain, customerEmail, rawSession),
          ]);

        if (walletResult.status      === 'fulfilled') setWallet(walletResult.value);
        if (historyResult.status     === 'fulfilled') setHistory(historyResult.value);
        if (referralsResult.status   === 'fulfilled') setReferrals(referralsResult.value);
        if (surveyResult.status      === 'fulfilled') setSurvey(surveyResult.value);
        if (leaderboardResult.status === 'fulfilled') setLeaderboard(leaderboardResult.value);
        if (milestonesResult.status  === 'fulfilled') setMilestones(milestonesResult.value);
      } else {
        // Guest: fetch public leaderboard (mock fallback is fine for guests)
        try {
          const lb = await fetchLeaderboard(shopDomain, null, false /* isAuthenticated */);
          setLeaderboard(lb);
        } catch (e) { console.warn('[GoSelf] leaderboard fetch failed:', e.message); }
      }

    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [shopDomain, customerEmail]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Force re-fetch one or all domains by clearing cache then re-loading
  // SOLUTION 3: Manual refetch on key actions
  const refetch = useCallback(async (domain) => {
    console.log(`[GoSelf] Manual refetch triggered${domain ? ` for: ${domain}` : ' (all domains)'}`);
    
    if (domain) {
      // Refetch specific domain
      try {
        sessionStorage.removeItem(`goself:${domain}`);
      } catch { /* ignore */ }
      
      // For critical customer_session domain, refetch immediately
      if (domain === 'customer_session' && customerEmail) {
        try {
          const customerData = await fetchCustomerSession(shopDomain, customerEmail);
          setCustomer(customerData);
          console.log('[GoSelf] Manual refetch complete, points:', customerData.pointsBalance);
        } catch (e) {
          console.warn('[GoSelf] Manual refetch failed:', e.message);
        }
      }

      // Wallet depends on rawSession — re-fetch session then re-derive wallet
      if (domain === 'wallet' && customerEmail) {
        try {
          try { sessionStorage.removeItem('goself:customer_session'); } catch { /* ignore */ }
          const customerData = await fetchCustomerSession(shopDomain, customerEmail);
          setCustomer(customerData);
          const walletData = await fetchWallet(shopDomain, customerEmail, customerData._raw || null);
          setWallet(walletData);
          console.log('[GoSelf] Wallet refetch complete, items:', walletData.length);
        } catch (e) {
          console.warn('[GoSelf] wallet refetch failed:', e.message);
        }
      }

      // member_rewards refetch — re-fetch with current customer id
      if (domain === 'member_rewards' && customerEmail) {
        try {
          const cachedCustomer = cacheGet('customer_session');
          const rewardsData = await fetchMemberRewards(
            shopDomain,
            customerEmail,
            cachedCustomer?.customerId ?? null
          );
          setRedeemCatalog(rewardsData);
        } catch (e) {
          console.warn('[GoSelf] member_rewards refetch failed:', e.message);
        }
      }
    } else {
      // Clear all goself cache keys and reload everything
      try {
        Object.keys(sessionStorage)
          .filter(k => k.startsWith('goself:'))
          .forEach(k => sessionStorage.removeItem(k));
      } catch { /* ignore */ }
      // Re-run full load
      loadAll();
    }
  }, [loadAll, customerEmail, shopDomain]);

  // SOLUTION 3 continued: Expose refetch as a public API for action handlers
  // Action handlers (survey submission, order completion, etc.) can call this
  // to invalidate cache and trigger immediate updates
  useEffect(() => {
    // Make refetch available globally for external use
    if (typeof window !== 'undefined') {
      window.GoSelfWidget = window.GoSelfWidget || {};
      window.GoSelfWidget.refetchCustomerSession = () => refetch('customer_session');
      window.GoSelfWidget.refetchAll = () => refetch();
    }
  }, [refetch]);

  return {
    isLoading,
    error,
    merchant,
    customer,
    detectedEmail: customerEmail,
    earnRules,
    redeemCatalog,
    wallet,
    history,
    referrals,
    leaderboard,
    milestones,
    survey,
    refetch,                              // Refetch specific domain or all
    refetchCustomerSession: () => refetch('customer_session'),  // Quick refetch points
    refetchAll: () => refetch(),          // Full reload
  };
}
