# Rewards Thank You Card

**Type:** Checkout UI Extension
**Target:** Order Status (Thank You) Page
**Shopify Compliance:** 2024-2025 ✓

## Merchant Installation

### IMPORTANT: No Script Injection Required

This extension uses Shopify's native checkout extensibility. NO manual code needed.

1. Go to **Settings → Checkout**
2. Click **Customize** next to your checkout profile
3. Navigate to **Order Status Page** (Thank You page)
4. Click **Add Block** or **Add App Block**
5. Select **"Rewards Thank You Card"**
6. Enter your **Widget ID** from Rewards dashboard
7. Click **Save**

## Features

- Native Shopify checkout UI components
- Automatic campaign rule evaluation
- Comprehensive order data extraction
- Real-time reward eligibility checking
- Privacy-compliant
- Read-only (no checkout mutation)
- Beautiful success banner design
- Direct claim button

## How It Works

1. Customer completes purchase on Thank You page
2. Extension extracts comprehensive order data:
   - Order value, ID, currency
   - Customer email and phone
   - Shipping/billing address with pincode
   - Product details (title, SKU, quantity, price, type)
   - Payment method information
   - Discount codes used
3. Data sent to backend API for campaign evaluation
4. Backend checks all active campaign rules
5. If customer qualifies → Personalized reward banner displays
6. If no match → Nothing shown (clean experience)

## API Integration

### Backend Endpoint

**URL:** `POST /functions/v1/check-campaign-rewards`

**Request Payload:**
```json
{
  "order_id": "gid://shopify/Order/123456",
  "order_value": 149.99,
  "currency": "USD",
  "customer_email": "customer@example.com",
  "customer_phone": "+1234567890",
  "shipping_address": {
    "address1": "123 Main St",
    "city": "New York",
    "province": "NY",
    "country": "United States",
    "zip": "10001"
  },
  "billing_address": { /* same structure */ },
  "line_items": [
    {
      "product_id": "gid://shopify/Product/123",
      "variant_id": "gid://shopify/ProductVariant/456",
      "title": "Product Name",
      "quantity": 2,
      "price": 74.99,
      "sku": "SKU-123",
      "product_type": "Electronics"
    }
  ],
  "payment_method": "Credit Card",
  "shop_domain": "yourstore.myshopify.com",
  "discount_codes": ["SAVE10"]
}
```

**Response on Success:**
```json
{
  "qualifies": true,
  "bannerTitle": "Congratulations! You've Earned Rewards! 🎉",
  "bannerMessage": "Thank you for your purchase! You've been enrolled in our VIP program.",
  "buttonText": "Claim Your Rewards",
  "rewardUrl": "https://rewards.example.com/claim?token=xyz",
  "clientName": "Your Brand Name",
  "campaignId": "uuid",
  "programName": "VIP Rewards"
}
```

**Response when No Match:**
```json
{
  "qualifies": false,
  "message": "Order does not qualify for rewards"
}
```

## Campaign Rule Evaluation

The backend evaluates campaigns based on:

### Trigger Conditions
- Order value (minimum, range)
- Item count
- Specific products purchased
- Coupon codes used
- Payment method (COD vs Prepaid)

### Eligibility Conditions
- Customer type (new vs returning)
- Order number (first order, nth order)
- Lifetime orders count
- Lifetime spend amount
- Customer tags

### Location Conditions
- Shipping pincode (exact, starts with, list)
- Shipping city
- Shipping state/province
- Shipping country

### Exclusion Rules
- Exclude refunded orders
- Exclude cancelled orders
- Exclude test orders

## Configuration

### Widget ID Setup
The Widget ID is optional but recommended for advanced features:
- Custom branding
- Click tracking
- A/B testing
- Analytics

### Shop Domain Mapping
The backend automatically identifies your client account using the shop domain from the order context.

## App Store Compliance

✓ Uses official Checkout UI Extensions
✓ No cart/checkout mutation
✓ No price modification
✓ Privacy-compliant
✓ Automatic cleanup on uninstall
✓ Read-only GraphQL queries
✓ Secure API communication

## Developer Notes

- Built with React + Shopify Checkout UI Extensions
- Uses Shopify Admin GraphQL API for order data
- Network requests to Supabase Edge Functions
- Real-time campaign evaluation
- No PII stored in extension
- All data transmitted securely via HTTPS

## Troubleshooting

**Banner not showing?**
- Verify shop is connected in Rewards Hub admin
- Check that campaigns are active
- Confirm order meets campaign criteria
- Check browser console for errors

**Wrong data displayed?**
- Verify Widget ID is correct
- Check shop domain configuration
- Review campaign rule settings

**Testing locally?**
- Use Shopify CLI: `shopify app dev`
- Create test orders in development store
- Check Supabase function logs for errors
