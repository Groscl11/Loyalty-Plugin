# GoSelf Loyalty Widget V6 — Data Map
> Ground truth for all data wiring. Last updated: 2026-03-12

---

## Backend
- **Supabase project:** `lizgppzyyljqbmzdytia.supabase.co`
- **Auth pattern:** Anon key in `Authorization: Bearer <key>` header
- All calls are Supabase Edge Functions (no direct table access from frontend).

---

## DOMAIN A — Merchant / Store Config

**Source:** `get-loyalty-status` (merged with customer response)  
**Endpoint:** `GET https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/get-loyalty-status`  
**Params:** `?email=<customer_email>&shop_domain=<shop_domain>`  
**Auth:** `Authorization: Bearer <SUPABASE_ANON_KEY>`

**Response shape (confirmed):**
```json
{
  "program": {
    "points_name": "Points",
    "points_per_currency_unit": 1
  },
  "tier": {
    "name": "Silver",
    "points_earn_rate": 1,
    "points_earn_divisor": 1,
    "multiplier": 1
  }
}
```

**Mapped to `data.merchant`:**
```js
{
  storeName: string,               // from Shopify shop object
  pointsPerRupee: number,          // program.points_per_currency_unit
  earnRules: EarnRule[],           // TODO: endpoint TBD
  redeemCatalog: RedeemItem[],     // TODO: endpoint TBD
  partnerBrands: PartnerBrand[],   // TODO: endpoint TBD
  tierThresholds: TierThreshold[], // TODO: endpoint TBD
  leaderboardPrizes: Prize[],      // from config (theme settings)
  surveyQuestions: Question[],     // TODO: endpoint TBD
  featureFlags: FeatureFlags       // from config (theme settings)
}
```

**TODO:** Backend team needs to expose dedicated merchant config endpoint.

---

## DOMAIN B — Customer Session

**Source:** `get-loyalty-status` (same endpoint as Domain A)  
**Endpoint:** `GET .../functions/v1/get-loyalty-status?email=&shop_domain=`

**Response shape (confirmed):**
```json
{
  "points_balance": 4280,
  "referral_code": "PRIYA200",
  "tier": { "name": "Silver" }
}
```

**Mapped to `data.customer`:**
```js
{
  customerId: string,
  firstName: string,
  email: string,
  phone: string | null,
  pointsBalance: number,          // points_balance
  tier: "bronze"|"silver"|"gold"|"platinum",
  referralCode: string,
  referralUrl: string,            // constructed: https://{shop}?ref={code}
  dob: string | null,
  anniversary: string | null,
  profileComplete: number,        // 0-100 percentage
}
```

---

## DOMAIN C — Rewards Catalog

**Endpoint:** `TODO: wire to GoSelf API — endpoint TBD by backend team`  
**Suggested:** `GET .../functions/v1/get-rewards-catalog?shop_domain=`

**Expected response:**
```json
[
  {
    "id": "rwrd_1",
    "type": "discount",
    "title": "₹100 off on ₹999+",
    "pointsCost": 500,
    "discountValue": "₹100",
    "sku": null,
    "brandName": null,
    "brandLogo": null,
    "brandUrl": null,
    "generatedCode": true
  }
]
```

**Mock shape used until endpoint is ready:**
```js
[
  { id: "1", type: "discount", title: "₹100 off on ₹999+", pointsCost: 500, discountValue: "₹100" },
  { id: "2", type: "discount", title: "Free shipping", pointsCost: 200, discountValue: "FREE" },
  { id: "3", type: "discount", title: "₹250 off on ₹1,999+", pointsCost: 1200, discountValue: "₹250" },
  { id: "4", type: "partner", title: "30% off sitewide", pointsCost: 800, discountValue: "30%", brandName: "Mamaearth", brandLogo: null, brandUrl: "https://mamaearth.in" },
  { id: "5", type: "free", title: "Free Bamboo Brush", pointsCost: 600, discountValue: "FREE" },
]
```

---

## DOMAIN D — Wallet / Coupons

**Endpoint:** `TODO: wire to GoSelf API — endpoint TBD by backend team`  
**Suggested:** `GET .../functions/v1/get-wallet?shop_domain=&customer_email=`

**Expected response:**
```json
[
  {
    "id": "cpn_1",
    "type": "discount",
    "status": "active",
    "code": "SAVE100",
    "title": "₹100 off ₹999+",
    "brand": "Houmetest",
    "discountValue": "₹100",
    "expiryDate": "2026-06-30",
    "usedDate": null
  }
]
```

**Mock shape used:**
```js
[
  { id: "w1", type: "discount", status: "active", code: "SAVE100", title: "₹100 off ₹999+", brand: "Houmetest", discountValue: "₹100", expiryDate: "2026-06-30" },
  { id: "w2", type: "partner", status: "active", code: "MAMA30", title: "30% off sitewide", brand: "Mamaearth", discountValue: "30%", expiryDate: "2026-06-15", brandUrl: "https://mamaearth.in" },
  { id: "w3", type: "free", status: "active", code: null, title: "Free Bamboo Brush", brand: "Houmetest", discountValue: "FREE", expiryDate: "2026-07-01" },
  { id: "w4", type: "discount", status: "used", code: "SHIP0", title: "Free shipping", brand: "Houmetest", discountValue: "FREE", usedDate: "2026-02-10" },
]
```

---

## DOMAIN E — Transaction History / Ledger

**Endpoint:** `TODO: wire to GoSelf API — endpoint TBD by backend team`  
**Suggested:** `GET .../functions/v1/get-transaction-history?shop_domain=&customer_email=`

**Expected response:**
```json
[
  {
    "id": "txn_1",
    "label": "Order #1234",
    "pointsDelta": 195,
    "type": "earn",
    "date": "2026-03-01T12:00:00Z",
    "icon": "🛍️"
  }
]
```

**Mock shape used:**
```js
[
  { id: "t1", label: "Order #1234", pointsDelta: 195, type: "earn", date: "2026-03-01", icon: "🛍️" },
  { id: "t2", label: "Referral Bonus", pointsDelta: 200, type: "earn", date: "2026-02-22", icon: "👥" },
  { id: "t3", label: "Survey Completed", pointsDelta: 75, type: "earn", date: "2026-02-15", icon: "📋" },
  { id: "t4", label: "Redeemed Coupon", pointsDelta: -500, type: "redeem", date: "2026-02-10", icon: "🎁" },
]
```

---

## DOMAIN F — Referrals

**Endpoint:** `TODO: wire to GoSelf API — endpoint TBD by backend team`  
**Suggested:** `GET .../functions/v1/get-referrals?shop_domain=&customer_email=`

**Expected response:**
```json
[
  {
    "refereeId": "cust_99",
    "refereeName": "Amit K.",
    "refereeEmail": "amit@example.com",
    "date": "2026-02-20",
    "status": "purchased",
    "orderValue": 1200,
    "ptsEarned": 200
  }
]
```

---

## DOMAIN G — Leaderboard

**Endpoint:** `TODO: wire to GoSelf API — endpoint TBD by backend team`  
**Suggested:** `GET .../functions/v1/get-leaderboard?shop_domain=`

**Expected response:**
```json
[
  {
    "rank": 1,
    "name": "Priya S.",
    "referralCount": 18,
    "ptsEarned": 3600,
    "isCurrentUser": true
  }
]
```

---

## DOMAIN H — Milestones

**Endpoint:** `TODO: wire to GoSelf API — endpoint TBD by backend team`  
**Suggested:** `GET .../functions/v1/get-milestones?shop_domain=&customer_email=`

**Expected response:**
```json
[
  {
    "id": "m1",
    "label": "First Purchase",
    "pointsRequired": 0,
    "reward": "Welcome bonus: +100 pts",
    "icon": "🛍️",
    "isCompleted": true
  }
]
```

---

## DOMAIN I — Survey

**Endpoint:** `TODO: wire to GoSelf API — endpoint TBD by backend team`  
**Suggested:** `GET .../functions/v1/get-survey?shop_domain=&customer_email=`

**Expected response:**
```json
{
  "questions": [
    { "id": "q1", "type": "single", "text": "How did you hear about us?", "options": ["Instagram", "Friend", "Google", "Other"] },
    { "id": "q2", "type": "rating", "text": "How likely are you to recommend us?", "maxRating": 5 }
  ],
  "rewardPts": 75
}
```

---

## Cache Keys (sessionStorage, TTL 60s)
| Key | Domain |
|-----|--------|
| `goself:merchant_config` | A |
| `goself:customer_session` | B |
| `goself:rewards_catalog` | C |
| `goself:wallet` | D |
| `goself:history` | E |
| `goself:referrals` | F |
| `goself:leaderboard` | G |
| `goself:milestones` | H |
| `goself:survey_questions` | I |

---

## AbortController pattern (8s timeout on all fetches)
```js
const ctrl = new AbortController()
const timeout = setTimeout(() => ctrl.abort(), 8000)
try {
  const res = await fetch(url, { signal: ctrl.signal })
  clearTimeout(timeout)
  return await res.json()
} catch (e) {
  clearTimeout(timeout)
  throw e
}
```
