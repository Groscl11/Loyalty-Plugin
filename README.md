# Loyalty by Goself — Shopify Plugin

Shopify app extensions powering the GoSelf loyalty and rewards programme. Two environments are supported via separate TOML configs:

| Environment | TOML | Shopify App | Supabase Project |
|---|---|---|---|
| Staging | `shopify.app.dev.toml` | Loyalty by Goself (Dev) | `jblqyvicxhmqqjhostcj` |
| Production | `shopify.app.toml` | Loyalty by Goself | `lizgppzyyljqbmzdytia` |

---

## Extensions

### 1. Loyalty Rewards Widget — `loyalty-widget`
**Type:** Theme App Extension  
**Install:** Online Store → Themes → Customize → App Embeds → toggle on  
**Purpose:** Main floating loyalty widget — shows points balance, tier, earning rules, redemption options, referral tab, leaderboard, surveys, partner brands.  
**Config:** 47 settings (branding, messaging, tab visibility, leaderboard prizes)  
**Build:**
```bash
npm run build:widget          # production bundle
npm run build:widget:staging  # staging bundle
```

---

### 2. Show Points Earned On This Order — `order-status-rewards`
**Type:** UI Extension  
**Surface:** `purchase.thank-you.block.render` (Thank You page)  
**Install:** Checkout editor → Thank You page → Add block  
**Purpose:** Shows points earned on the just-completed order. Members see `+X Points 🎉` and new balance. Non-members see a Join CTA banner.  
**Settings:**

| Key | Description |
|---|---|
| `supabase_project_id` | `jblqyvicxhmqqjhostcj` (staging) or `lizgppzyyljqbmzdytia` (prod) |
| `heading_text` | Section label (default: "Rewards Earned on This Order") |
| `referral_reward_text` | e.g. "15% Off Coupon" shown to non-members |

**Edge Function:** `get-loyalty-status`

---

### 3. Order Rewards & Referral — `order-rewards`
**Type:** UI Extension  
**Surfaces:**
- `customer-account.order-index.block.render` (order list page)
- `customer-account.order-status.block.render` (order detail page)

**Install:** Customer account editor → Add block to both surfaces  
**Purpose:** Shows total loyalty points balance + tier on the order list; shows points earned on a specific order + referral share links (WhatsApp, Twitter, Gmail, Facebook) on the order detail page.  
**Settings:**

| Key | Description |
|---|---|
| `supabase_project_id` | `jblqyvicxhmqqjhostcj` (staging) or `lizgppzyyljqbmzdytia` (prod) |
| `heading_text` | Section label |
| `referral_reward_text` | e.g. "15% Off Coupon" |

**Edge Function:** `get-loyalty-status`

---

### 4. Post Purchase Rewards — `campaign-reward-banner`
**Type:** UI Extension  
**Surfaces:**
- `purchase.thank-you.block.render` (Thank You page)
- `customer-account.order-status.block.render` (Order Status page)

**Install:** Checkout editor + Customer account editor → Add block to both surfaces  
**Purpose:** Campaign-based one-time reward delivery. After an order qualifies for a campaign, shows a personalised gift banner with a tokenised redemption link (e.g. partner brand voucher). Uses exponential backoff (1s → 2s → 4s → 8s, up to 5 attempts) to wait for the Shopify webhook to process.  
**Settings:**

| Key | Description |
|---|---|
| `campaign_id` | GoSelf campaign ID (find in GoSelf Admin → Campaigns) |
| `banner_body` | Message shown (e.g. "Grab your exclusive voucher and get up to 80% Off") |
| `button_text` | CTA button label (default: "Claim Now") |
| `supabase_project_id` | `jblqyvicxhmqqjhostcj` (staging) or `lizgppzyyljqbmzdytia` (prod) |

**Edge Function:** `get-campaign-reward-link`

---

### 5. Referral Widget — `referral-widget`
**Type:** UI Extension  
**Surface:** `purchase.thank-you.block.render` (Thank You page)  
**Install:** Checkout editor → Thank You page → Add block  
**Purpose:** Shows a logged-in member's referral link with one-click share to WhatsApp/Twitter/Gmail/Facebook and a Copy Link button. Non-members see a prompt to sign in.  
**Settings:**

| Key | Description |
|---|---|
| `referral_reward_text` | e.g. "15% Off Coupon" |
| `supabase_project_id` | `jblqyvicxhmqqjhostcj` (staging) or `lizgppzyyljqbmzdytia` (prod) |

**Edge Function:** `get-loyalty-status`

---

## Edge Functions (Supabase)

| Function | Called By | Purpose |
|---|---|---|
| `get-loyalty-status` | points-earned, order-rewards, referral-widget | Member points, tier, earn rates, referral code, programme name |
| `get-campaign-reward-link` | campaign-reward-banner | Checks campaign eligibility → returns tokenised one-time claim URL |
| `shopify-order-webhook` | Shopify `orders/create`, `orders/paid` | Credits points, processes campaign triggers |
| `shopify-oauth-callback` | Shopify OAuth | Handles merchant install / auth |
| `shopify-customers-data-request` | Shopify GDPR | Returns customer data on merchant request |
| `shopify-customers-redact` | Shopify GDPR | Deletes customer data |
| `shopify-shop-redact` | Shopify GDPR | Deletes shop data on uninstall |

---

## Deployment

### Deploy to Staging
```bash
shopify app deploy --config dev --allow-updates
```

### Deploy to Production
```bash
shopify app deploy --allow-updates
```

### Build Loyalty Widget JS Bundle
```bash
npm run build:widget           # production (lizgppzyyljqbmzdytia)
npm run build:widget:staging   # staging (jblqyvicxhmqqjhostcj)
npm run build:widget:dev       # staging + sourcemaps
```

---

## Supabase Config Pattern

All UI extensions use a runtime config map so the same bundle works in both environments. Merchants set `supabase_project_id` in the Shopify theme/checkout editor settings; if left blank the extension defaults to staging.

```javascript
const SUPABASE_CONFIGS = {
  'lizgppzyyljqbmzdytia': { url: '...prod...', key: '...' },
  'jblqyvicxhmqqjhostcj': { url: '...staging...', key: '...' },
};
const projectId = settings?.supabase_project_id || 'jblqyvicxhmqqjhostcj';
const { url, key } = SUPABASE_CONFIGS[projectId] || SUPABASE_CONFIGS['jblqyvicxhmqqjhostcj'];
```

---

## App Store Submission Checklist

- [x] GDPR webhooks configured in both `shopify.app.toml` and `shopify.app.dev.toml`
- [x] All extensions use `network_access = true` and `api_access = true`
- [x] All extensions support both prod and staging via `supabase_project_id` setting
- [x] `referral-widget` setCopied state fixed (was undeclared — runtime crash)
- [x] Loading states on all extensions (no silent blank periods)
- [x] Error fallbacks (network failures show appropriate UI, not blank)
- [x] Editor preview mode in `campaign-reward-banner` via `useExtensionEditor`
- [x] Retry/backoff logic in `campaign-reward-banner` for webhook latency
- [x] Archived/dead-code directories removed
- [ ] Set `supabase_project_id` to `lizgppzyyljqbmzdytia` in production theme/checkout editor for each extension
