# Shopify Widget Extensions

**Shopify 2024-2025 Compliant**
All deprecated installation methods have been removed.

## Overview

This directory contains 6 Shopify-native extensions that power the Rewards Widget system:

1. **Floating Widget** - Theme App Extension (App Embed)
2. **Thank You Card** - Checkout UI Extension (Order Status Page)
3. **Product Banner** - Theme App Extension (Section Block)
4. **Cart Rewards** - Cart UI Extension
5. **Announcement Bar** - Theme App Extension (App Block)
6. **Membership Portal** - App Proxy

## Key Changes from Legacy System

### REMOVED (Deprecated)
- ❌ Manual script injection into theme.liquid
- ❌ Additional scripts on Order Status page
- ❌ Code editing requirements for merchants
- ❌ `<script src=...>` instructions

### NEW (Shopify-Compliant)
- ✅ Theme App Extensions (install via Theme Customizer)
- ✅ Checkout UI Extensions (install via Checkout Editor)
- ✅ Cart UI Extensions (install via Theme Customizer)
- ✅ App Proxy for full portal experience
- ✅ All widgets install through Shopify admin UI
- ✅ Automatic cleanup on app uninstall

## Installation Methods by Widget Type

| Widget Type | Installation Method | Merchant Instructions |
|-------------|---------------------|----------------------|
| Floating | Theme Customizer → App Embeds | Toggle ON |
| Thank You Card | Checkout Settings → Customize → Order Status Page | Add Block |
| Product Banner | Theme Customizer → Product Page | Add Block |
| Cart Rewards | Theme Customizer → Cart | Add Block |
| Announcement Bar | Theme Customizer → Header | Add Block |
| Membership Portal | App Proxy + Navigation | Configure & Add Link |

## Architecture

### Unified API Endpoint

All widgets call a single API endpoint:

```
POST /api/widgets/render
```

Request payload:
```json
{
  "widget_type": "floating|thankyou_card|product_banner|cart_drawer|announcement_bar|membership_portal",
  "widget_id": "uuid",
  "shop": "store.myshopify.com",
  "customer_id": "gid://shopify/Customer/123",
  "page_context": { "type": "product", "product_id": "123" },
  "order_id": "gid://shopify/Order/456",
  "cart_value": 99.99
}
```

Response:
```json
{
  "should_render": true,
  "ui_payload": {
    "title": "Your Reward",
    "description": "Claim your exclusive benefit",
    "reward_details": { ... }
  },
  "redeem_url": "/apps/rewards/claim"
}
```

### Data Flow

1. Widget loads in Shopify storefront
2. Widget gathers context (customer, order, cart, etc.)
3. Widget calls `/api/widgets/render` endpoint
4. Backend checks eligibility, fetches reward data
5. Backend returns rendering instructions
6. Widget displays UI to customer

## App Store Compliance

All extensions meet Shopify App Store requirements:

- ✅ Read-only (no cart/checkout mutation)
- ✅ No automatic discounts
- ✅ No price modification
- ✅ No checkout blocking
- ✅ Privacy-compliant
- ✅ Proper error handling
- ✅ Responsive design

## Development

### Testing Extensions

1. **Theme Extensions:**
   ```bash
   shopify app dev
   ```
   - Open development store
   - Navigate to Theme Customizer
   - Find your extensions

2. **Checkout Extensions:**
   ```bash
   shopify app dev
   ```
   - Enable in Checkout Settings
   - Test order flow

3. **Preview Mode:**
   - Preview feature in admin dashboard works independently
   - Shows visual representation without Shopify connection

### Deployment

Deploy extensions via Shopify CLI:

```bash
shopify app deploy
```

This deploys all extensions to your app in the Partner Dashboard.

## Security Notes

- All widgets verify shop and customer identity
- API endpoints require authentication
- Customer data handled per GDPR requirements
- No sensitive data in client-side code
- Signature verification on App Proxy requests

## TODO for Production

- [ ] Configure API endpoint URLs in extension settings
- [ ] Add authentication headers to API calls
- [ ] Set up App Proxy URL in Partner Dashboard
- [ ] Test each extension in development store
- [ ] Submit app for Shopify review
- [ ] Configure webhook handlers for order events

## Support

Each extension has its own README with detailed:
- Installation instructions
- Features
- Use cases
- Developer notes
- Troubleshooting

See individual extension directories for more information.
