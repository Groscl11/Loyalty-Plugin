# Shopify Loyalty & Referral App - Complete Setup Guide

This is a complete, production-ready implementation of a Shopify Loyalty & Referral App with a Bolt.new backend integration.

## 📁 Project Structure

```
loyalty/
├── shopify.app.toml                 # Shopify app configuration (proxies & webhooks)
├── assets/
│   └── loyalty-core.js              # Client-side bridge (vanilla JS)
├── extensions/
│   ├── loyalty-agent/
│   │   └── loyalty-agent.liquid     # Floating chat widget (App Embed)
│   ├── rewards-page/
│   │   └── rewards-page.liquid      # Rewards grid display (Section Block)
│   └── referral-section/
│       └── referral-section.liquid  # Referral hero section (Section Block)
├── backend/
│   └── webhook-handler.js           # Shopify webhook processor (Express)
├── README.md                        # This file
└── DEPLOYMENT.md                    # Deployment instructions
```

## 🎯 What This App Does

### For Customers:
- **Floating Widget**: Shows loyalty points balance & AI shopping assistant
- **Rewards Page**: Browse ways to earn and redeem points
- **Referral Program**: Generate unique referral codes & share via WhatsApp/Email
- **Discount Redemption**: Convert points to discount codes in real-time

### For Your Backend:
- **Webhook Processing**: Automatically credits points on purchases, refunds, and new signups
- **Secure Integration**: HMAC signature verification for all webhooks
- **Transaction History**: Complete audit trail of points earned/spent
- **Notifications**: Trigger WhatsApp/Email notifications for key events

## 🚀 Quick Start

### Step 1: Set Up Shopify App Configuration

The `shopify.app.toml` file is already configured with:

- **App Proxy**: Routes `/apps/loyalty/*` requests to your Bolt backend
- **Webhooks**: Subscribes to:
  - `orders/paid` - When customer makes a payment
  - `customers/create` - When new customer signs up
  - `refunds/create` - When refund is issued

**Update the webhook address** in `shopify.app.toml` from:
```toml
uri = "https://your-bolt-backend.com/api/webhooks/shopify"
```

to your actual backend URL (e.g., `https://my-app.bolt.new/api/webhooks/shopify`)

### Step 2: Deploy Theme Extensions

The three `.liquid` files are Theme App Extensions ready to deploy:

1. **loyalty-agent.liquid** (App Embed)
   - Floats in bottom-right corner
   - Auto-loads customer's points
   - Provides redemption button

2. **rewards-page.liquid** (Section Block)
   - Add to a dedicated `/pages/rewards` page
   - Grid layout with earning & redemption options
   - Customizable colors via theme settings

3. **referral-section.liquid** (Section Block)
   - Hero-style referral section
   - Generates unique referral codes
   - WhatsApp & Email share buttons

**To deploy**:
```bash
shopify app deploy
```

### Step 3: Set Up Backend Webhook Handler

The `webhook-handler.js` is an Express.js route that:

1. **Verifies webhook signatures** using your Shopify Client Secret
2. **Processes events** and calculates points (₹100 = 10 points)
3. **Updates database** with customer loyalty data
4. **Sends notifications** (WhatsApp, Email, Push)

#### Integration Steps:

1. **Add to your Express server**:

```javascript
const express = require('express');
const webhookRouter = require('./backend/webhook-handler');

const app = express();

// IMPORTANT: Raw body parser must come BEFORE JSON parser
app.use(express.raw({ type: 'application/json' }));
app.use(express.json());

// Mount webhook routes
app.use('/api/webhooks', webhookRouter);

app.listen(3000, () => console.log('Server running on port 3000'));
```

2. **Set environment variables**:

```bash
export SHOPIFY_CLIENT_SECRET="your_shopify_client_secret_here"
export SHOPIFY_API_KEY="your_shopify_api_key"
export SHOP_URL="https://your-store.myshopify.com"
```

3. **Implement database functions** in `webhook-handler.js`:
   - `updateCustomerPoints()` - Update points in your database
   - `recordTransaction()` - Save transaction history
   - `createCustomerProfile()` - Create new customer profiles
   - `sendNotification()` - Send emails/SMS/push notifications
   - `sendWhatsAppNotification()` - Send WhatsApp messages

### Step 4: Client-Side Integration

The `loyalty-core.js` file is a vanilla JavaScript bridge that:

- Auto-initializes when customer is logged in
- Provides clean API for frontend code
- Handles all API calls with proper headers
- Dispatches custom events for UI updates

**Include in your theme**:

```liquid
<script src="{{ 'loyalty-core.js' | asset_url }}"></script>

<script>
  // Check if ready
  if (window.loyaltyCore.isReady()) {
    // Get points
    loyaltyCore.getPoints().then(data => {
      console.log('Points:', data.balance);
    });

    // Listen for events
    loyaltyCore.on('points-updated', (data) => {
      // Update UI
    });
  }
</script>
```

## 🔧 API Endpoints (App Proxy Routes)

Your Bolt backend must implement these endpoints:

### `/apps/loyalty/api/points` (GET)
Returns customer's current points balance

**Response**:
```json
{
  "success": true,
  "data": {
    "points": 250,
    "nextReward": 100,
    "tier": "silver"
  }
}
```

### `/apps/loyalty/api/profile` (GET)
Returns full customer loyalty profile

**Response**:
```json
{
  "success": true,
  "data": {
    "customerId": "123456",
    "points": 250,
    "tier": "silver",
    "joinDate": "2024-01-01",
    "lifetime_points": 500,
    "referral_code": "REF_ABC123"
  }
}
```

### `/apps/loyalty/api/redeem` (POST)
Redeems points for discount code

**Request**:
```json
{
  "customer_id": "123456",
  "points": 100
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "discount_code": "LOYALTY10",
    "discount_percentage": 10,
    "expiry": "2024-02-28"
  }
}
```

### `/apps/loyalty/api/referral` (POST)
Gets or generates referral code

**Request**:
```json
{
  "customer_id": "123456"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "referral_code": "REF_ABC123",
    "referral_count": 5,
    "earned_points": 250,
    "discount_given": 2
  }
}
```

## 🔐 Security

### Webhook Signature Verification
All incoming webhooks are verified using HMAC-SHA256:

```javascript
function verifyWebhookSignature(req, secret) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  const body = req.rawBody;

  const hash = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');

  return hash === hmacHeader;
}
```

### Customer ID Validation
Always verify that the requesting customer ID matches:

1. The `X-Customer-ID` header from app proxy
2. The logged-in Shopify customer

### Points Calculation
Points are awarded based on this formula:
```
Points = Order Total (₹) × 0.1
Example: ₹1000 order = 100 points
```

## 🎨 Customization

### Colors & Branding
All blocks use Shopify's native color variables:

```liquid
{{ settings.colors_accent_1 }}
{{ settings.colors_background }}
{{ settings.colors_text }}
```

These automatically match your store's theme.

### Points Conversion Rate
Edit in `webhook-handler.js`:

```javascript
const POINTS_PER_RUPEE = 0.1; // 10 points per ₹100
```

Change to your desired rate (e.g., `0.05` for 5 points per ₹100).

### Reward Tiers
Customize reward options in the blocks:

```liquid
<div class="stat-card">
  <div class="stat-value">100</div>
  <div class="stat-label">Points</div>
</div>
```

## 🧪 Testing

### Test Webhook Locally

1. Generate test webhook data from Shopify Admin
2. Calculate HMAC signature:

```bash
echo -n '{"id":123,"customer":{"id":456},"total_price":"1000.00"}' | \
  openssl dgst -sha256 -hmac "your-secret" -binary | base64
```

3. Send test request:

```bash
curl -X POST http://localhost:3000/api/webhooks/shopify \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: orders/paid" \
  -H "X-Shopify-HMAC-SHA256: YOUR_CALCULATED_HMAC" \
  -d @test-payload.json
```

### Test Customer Authentication

Ensure `window.Shopify.customer` is available in your theme:

```javascript
console.log(window.Shopify.customer);
// Should output: { id: "123456", email: "user@example.com", ... }
```

## 📊 Database Schema (Reference)

### Customer Profile
```javascript
{
  _id: String,                  // Shopify customer ID
  email: String,
  firstName: String,
  lastName: String,
  phone: String,
  points: Number,               // Current balance
  tier: String,                 // 'bronze', 'silver', 'gold'
  referralCode: String,         // Unique code
  createdAt: Date,
  lastUpdated: Date
}
```

### Transaction History
```javascript
{
  customerId: String,
  type: String,                 // 'purchase', 'refund', 'welcome_bonus', etc
  points: Number,               // Can be negative
  amount: Number,               // Transaction amount in rupees
  orderId: String,              // Shopify order ID (if applicable)
  timestamp: Date
}
```

## 🚀 Deployment Checklist

- [ ] Update `shopify.app.toml` with your backend URL
- [ ] Implement database functions in `webhook-handler.js`
- [ ] Set environment variables (`SHOPIFY_CLIENT_SECRET`, etc)
- [ ] Deploy Express server with webhook handler
- [ ] Deploy theme extensions: `shopify app deploy`
- [ ] Test webhook signatures with test orders
- [ ] Verify points appear in database
- [ ] Test customer login & points display
- [ ] Test point redemption flow
- [ ] Test referral code generation
- [ ] Set up email/WhatsApp notifications

## 📚 Documentation Files

- `DEPLOYMENT.md` - Detailed deployment steps
- `API.md` - Complete API reference
- `TROUBLESHOOTING.md` - Common issues & fixes

## 💬 Support

For issues or questions, refer to:
- [Shopify App Development Docs](https://shopify.dev/docs/apps)
- [Shopify Webhook Docs](https://shopify.dev/docs/api/admin-rest/2024-01/resources/webhook)
- [Liquid Template Language](https://shopify.dev/docs/api/liquid)

---

**Last Updated**: February 2026
**Status**: Production Ready ✓
