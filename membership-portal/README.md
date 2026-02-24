# Rewards Membership Portal

**Type:** App Proxy
**Shopify Compliance:** 2024-2025 ✓

## Merchant Installation

### Step 1: Configure App Proxy

1. Go to **Shopify Admin → Apps → Your App**
2. Click **App Setup** or **Configuration**
3. Find **App Proxy** section
4. Configure:
   - **Subpath prefix:** `rewards`
   - **Subpath:** `portal`
   - **Proxy URL:** `YOUR_API_ENDPOINT/portal`
5. Click **Save**

### Step 2: Add Navigation Link

**Option A: Main Menu**
1. Go to **Online Store → Navigation**
2. Select your **Main Menu**
3. Click **Add menu item**
4. **Name:** "My Rewards" (or preferred text)
5. **Link:** `/apps/rewards`
6. Click **Save menu**

**Option B: Customer Account**
1. Go to **Online Store → Themes → Customize**
2. Navigate to **Customer Account** section
3. Add link: `/apps/rewards`

### Step 3: Test

1. Visit your store as a logged-in customer
2. Navigate to `/apps/rewards`
3. Portal should load with customer-specific data

## Features

### Full Portal Experience

- **Dashboard:** Overview of rewards, points, membership status
- **Available Rewards:** Browse and claim rewards
- **My Vouchers:** View active and used vouchers
- **Membership Details:** Program info, tier status, benefits
- **History:** Transaction and claim history
- **Marketplace:** Browse partner brand rewards

### Customer Authentication

- Automatically authenticated via Shopify customer session
- Secure customer_id passed to your backend
- No separate login required

### Responsive Design

- Mobile-first design
- Works on all devices
- Integrates with store theme colors

## How It Works

1. Customer navigates to `/apps/rewards`
2. Shopify routes request to your app via proxy
3. Your backend receives:
   - `customer[id]`
   - `customer[email]`
   - `shop`
   - Other Shopify context
4. Your app renders full HTML portal
5. Portal includes JavaScript for interactive features
6. All API calls route through your backend

## API Endpoints

Your app should handle these routes:

```
GET  /portal                    # Main portal page
GET  /portal/rewards            # Rewards marketplace
GET  /portal/vouchers           # Customer vouchers
GET  /portal/membership         # Membership details
GET  /portal/history            # Transaction history
POST /portal/claim/:reward_id   # Claim reward
```

## Security

- Verify Shopify signatures on all requests
- Validate customer_id
- Use HTTPS only
- Session-based authentication
- CSRF protection

## App Store Compliance

✓ Uses official App Proxy mechanism
✓ No theme file modification
✓ Customer data privacy compliant
✓ Automatic cleanup on uninstall
✓ Read-only cart/checkout operations

## Developer Notes

- Built with your existing React frontend
- API endpoints route through Supabase Edge Functions
- Customer context automatically provided by Shopify
- TODO: Implement signature verification
- TODO: Configure proxy URL in Shopify Partner Dashboard
- TODO: Add portal routes to your backend

## Testing Locally

When developing locally:
1. Use ngrok or similar to expose local server
2. Configure App Proxy URL to your tunnel URL
3. Test with customer account in development store
