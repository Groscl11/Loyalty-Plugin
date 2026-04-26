# RewardHub Loyalty Widget for Shopify

A beautiful, floating loyalty rewards widget for Shopify stores that displays customer points, ways to earn, and redemption options - similar to Nector.io, Smile.io, and Yotpo.

## Features

- **Floating Widget Button** - Customizable position and colors
- **Points Balance Display** - Show customer's current loyalty points
- **Tier Progress** - Visual progress bar to next loyalty tier
- **Transaction History** - Recent points earned and redeemed
- **Ways to Earn** - Interactive list of earning opportunities
- **Ways to Redeem** - Available rewards with points cost
- **Auto-Redeem Option** - Toggle for automatic coupon application
- **Mobile Responsive** - Works perfectly on all devices
- **Real-time Data** - Connected to RewardHub backend

## Preview

The widget includes:
- Floating button with lightning bolt icon
- Slide-out panel with tabs (History, Ways To Earn, Ways To Redeem)
- Beautiful gradient design
- Smooth animations
- Customizable colors and branding

## Installation Methods

### Method 1: Theme App Extension (Recommended)

This method creates an app block that store owners can drag-and-drop in their theme editor.

#### Requirements
- Shopify CLI installed
- Shopify Partner account
- Access to store with theme 2.0 support

#### Steps

1. **Install Shopify CLI**
```bash
npm install -g @shopify/cli @shopify/theme
```

2. **Navigate to Project**
```bash
cd /path/to/project/extensions/loyalty-widget
```

3. **Deploy Extension**
```bash
shopify app deploy
```

4. **Enable in Shopify Theme**
   - Go to Shopify Admin → Online Store → Themes
   - Click "Customize" on your theme
   - Click "Add app block"
   - Select "Loyalty Rewards Widget"
   - Drag to desired location (footer recommended)
   - Customize settings:
     - Show/hide floating button
     - Button position (bottom-right, bottom-left, etc.)
     - Primary color
     - Accent color
     - Points name
     - Auto-redeem option

### Method 2: Direct Code Installation (Alternative)

If you can't use theme app extensions, you can manually add the widget code.

#### Step 1: Add Widget to Theme

1. Go to **Shopify Admin → Online Store → Themes**
2. Click **Actions → Edit code**
3. Create new snippet: **loyalty-widget.liquid**
4. Copy the entire content from `blocks/loyalty-widget.liquid`
5. Paste into the new snippet
6. Save

#### Step 2: Include Widget in Theme

Add this line to your `theme.liquid` file before `</body>`:

```liquid
{% render 'loyalty-widget' %}
```

#### Step 3: Configure Settings

Edit the widget settings in the code:
- Line 12-34: Button position and colors
- Line 158: Points name
- Line 166: Auto-redeem option

### Method 3: Script Tag Installation (Fastest)

For quick testing or if you don't have theme access:

1. **Create Script in Shopify**
   - Go to **Shopify Admin → Online Store → Preferences**
   - Scroll to **Google Analytics → Additional Scripts**
   - Add this script tag:

```html
<script>
  (function() {
    var script = document.createElement('script');
    script.src = 'https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/widget-render?type=loyalty';
    script.async = true;
    document.body.appendChild(script);
  })();
</script>
```

2. **Save Changes**

The widget will now appear on all pages of your store.

## Configuration Options

### Widget Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `show_floating_button` | Boolean | `true` | Show/hide the floating widget button |
| `button_position` | Select | `bottom-right` | Position of floating button |
| `primary_color` | Color | `#3B82F6` | Main brand color (button, headers) |
| `accent_color` | Color | `#10B981` | Accent color (points, earned) |
| `points_name` | Text | `Rewards Points` | Name for loyalty points |
| `auto_redeem` | Boolean | `false` | Enable auto-redeem toggle |

### Button Positions
- `bottom-right` - Bottom right corner (default)
- `bottom-left` - Bottom left corner
- `top-right` - Top right corner
- `top-left` - Top left corner

## How It Works

### 1. Customer Authentication
- Widget checks if customer is logged in
- Shows login prompt if not authenticated
- Automatically loads data for logged-in customers

### 2. Data Loading
- Fetches loyalty status from RewardHub API
- Gets points balance, tier, and transactions
- Loads available rewards

### 3. Real-time Updates
- Points update after purchases
- Transactions show instantly
- Rewards sync with backend

### 4. Redemption Flow
- Customer selects reward
- Widget calls redemption API
- Discount code generated
- Code displayed to customer

## API Endpoints Used

### Get Loyalty Status
```
GET https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/get-loyalty-status
?email={customer_email}&shop={shop_domain}
```

**Response:**
```json
{
  "points_balance": 1000,
  "lifetime_points_earned": 2500,
  "tier": {
    "name": "Gold",
    "level": 2,
    "color": "#FFD700"
  },
  "recent_transactions": [...]
}
```

### Get Customer Rewards
```
POST https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/get-customer-rewards

{
  "customer_email": "customer@example.com",
  "shop_domain": "store.myshopify.com"
}
```

**Response:**
```json
{
  "success": true,
  "rewards": [
    {
      "id": "...",
      "name": "$5 Off Coupon",
      "description": "Save $5 on your next purchase",
      "value_amount": 500
    }
  ]
}
```

### Redeem Loyalty Points
```
POST https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/redeem-loyalty-points

{
  "email": "customer@example.com",
  "shop": "store.myshopify.com",
  "reward_id": "...",
  "points": 500
}
```

**Response:**
```json
{
  "success": true,
  "discount_code": "SAVE5-ABC123",
  "new_balance": 500
}
```

## Customization

### Changing Colors

Update the style section to match your brand:

```liquid
background: {{ block.settings.primary_color }};  <!-- Main color -->
color: {{ block.settings.accent_color }};         <!-- Accent color -->
```

### Changing Widget Size

Modify the CSS in the `<style>` section:

```css
.rewardhub-panel {
  width: 400px;  /* Change width */
  max-height: 600px;  /* Change height */
}
```

### Adding Custom Earn Actions

Add more earning opportunities in the "Ways To Earn" tab:

```html
<div class="earn-item">
  <div class="earn-icon">🎁</div>
  <div class="earn-info">
    <h5>Your Custom Action</h5>
    <p>Earn <strong>100</strong> points</p>
  </div>
  <button class="earn-btn">Do It</button>
</div>
```

### Translating Text

All text strings are customizable. Search and replace:
- "Thanks for joining our tribe!" → Your custom welcome message
- "Ways To Earn" → Your custom label
- "Ways To Redeem" → Your custom label
- "Powered by RewardHub" → Your custom footer

## Mobile Optimization

The widget is fully responsive with these breakpoints:

```css
@media (max-width: 480px) {
  .rewardhub-panel {
    width: calc(100vw - 40px);
    height: 500px;
  }
}
```

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance

- Lazy loading - Widget loads only when opened
- Cached data - API responses cached for 5 minutes
- Optimized images - No external image dependencies
- Minimal JavaScript - < 10KB gzipped

## Troubleshooting

### Widget Not Appearing
1. Check if `show_floating_button` is enabled
2. Verify widget code is in theme
3. Clear browser cache
4. Check browser console for errors

### Data Not Loading
1. Verify customer is logged in
2. Check API endpoint URLs
3. Ensure customer has loyalty account
4. Check network tab in browser DevTools

### Points Not Updating
1. Refresh the page
2. Close and reopen widget
3. Check if webhooks are working
4. Verify order is marked as paid

### Redemption Not Working
1. Verify customer has enough points
2. Check reward is still available
3. Ensure redemption API is accessible
4. Check Supabase function logs

## Support

For issues or questions:
- Check the [main documentation](../../README.md)
- Review [Shopify integration guide](../../SHOPIFY_INTEGRATION_GUIDE.md)
- Contact support at your-support-email

## License

This widget is part of the RewardHub loyalty platform.

---

## One-Click Installation Link

To create a one-click installation link for merchants:

1. **Create Shopify App** (if not already created)
   - Go to Shopify Partners
   - Create new app
   - Set OAuth redirect to your callback URL

2. **Installation URL Format:**
```
https://store.myshopify.com/admin/oauth/authorize?client_id=YOUR_API_KEY&scope=read_orders,write_customers,read_customers&redirect_uri=https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/shopify-oauth-callback
```

3. **Share This Link** with merchants to install in one click!

When they click the link:
1. Shopify OAuth screen appears
2. Merchant approves permissions
3. Your system auto-registers the store
4. Widget is ready to use immediately

---

**Built with ❤️ by RewardHub**
