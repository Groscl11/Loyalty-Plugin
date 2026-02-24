# Engage Universal - App Embed Extension

A Shopify Theme App Extension that displays a floating rewards widget on any page of your store.

## Features

- Floating button widget with badge count
- Expandable reward panel
- Mobile responsive
- Configurable position (4 corners)
- Auto-open option
- Shows available rewards for logged-in customers
- One-click reward redemption

## Installation

### Step 1: Deploy the Extension

```bash
# From project root
shopify app deploy
```

### Step 2: Enable in Theme Editor

1. Go to **Shopify Admin → Online Store → Themes**
2. Click **Customize** on your active theme
3. In the left sidebar, click **App embeds** (bottom section)
4. Find **Engage Universal** and toggle it ON
5. Click the extension to configure settings
6. Enter your **RewardHub Widget ID**
7. Choose widget position and other options
8. Click **Save**

### Step 3: Deploy Edge Function

The extension requires the `get-customer-rewards` edge function:

```bash
# Deploy the function
supabase functions deploy get-customer-rewards
```

## Configuration Options

### Widget ID (Required)
- The widget ID from your RewardHub dashboard
- Example: `universal-widget-v1`

### Position
- **Bottom Right** (default) - Most common position
- **Bottom Left** - Alternative bottom position
- **Top Right** - Less intrusive
- **Top Left** - Rarely used

### Show on Mobile
- **Enabled** (default) - Widget appears on mobile devices
- **Disabled** - Widget hidden on mobile (< 768px)

### Auto Open
- **Disabled** (default) - User must click to open
- **Enabled** - Panel opens automatically 2 seconds after page load

## How It Works

### 1. Widget Button
- Floating circular button with star icon
- Shows badge with reward count
- Positioned based on configuration
- Always visible (sticky)

### 2. Widget Panel
- Opens on button click
- Shows loading state while fetching
- Displays available rewards
- Each reward has:
  - Name
  - Description
  - Claim button with redemption link

### 3. Customer States

#### Not Logged In
```
┌──────────────────────┐
│  Your Rewards        │
├──────────────────────┤
│                      │
│  Sign in to view     │
│  your rewards        │
│                      │
│  [  Sign In  ]       │
│                      │
└──────────────────────┘
```

#### No Rewards
```
┌──────────────────────┐
│  Your Rewards        │
├──────────────────────┤
│                      │
│  No rewards          │
│  available yet       │
│                      │
│  Keep shopping to    │
│  earn rewards!       │
│                      │
└──────────────────────┘
```

#### Has Rewards
```
┌──────────────────────┐
│  Your Rewards      ✕ │
├──────────────────────┤
│  ┌────────────────┐  │
│  │ 10% Off        │  │
│  │ Your next      │  │
│  │ purchase       │  │
│  │ [Claim Reward] │  │
│  └────────────────┘  │
│  ┌────────────────┐  │
│  │ Free Shipping  │  │
│  │ Orders over $50│  │
│  │ [Claim Reward] │  │
│  └────────────────┘  │
└──────────────────────┘
```

## Widget ID Setup

### Create Widget in Dashboard

1. Login to RewardHub dashboard
2. Navigate to **Widget Configurations**
3. Click **New Widget**
4. Fill in:
   ```
   Widget ID: universal-widget-v1
   Widget Type: embedded
   Name: Universal Rewards Widget
   Description: Floating widget for all pages

   Content:
     Title: Your Rewards
     Description: View and claim your rewards

   Styles:
     Primary Color: #667eea
     Secondary Color: #764ba2
   ```
5. Click **Create**
6. Copy the Widget ID

### Add to Shopify

1. Go to Theme Customizer
2. Enable **Engage Universal** app embed
3. Paste the Widget ID
4. Configure position and options
5. Save

## Technical Details

### Files Structure

```
extensions/engage-universal/
├── shopify.extension.toml       # Extension configuration
├── blocks/
│   └── rewards-widget.liquid    # Main widget block
├── assets/                      # (optional) Additional assets
└── README.md                    # This file
```

### Liquid Block

The block uses:
- **Liquid** for server-side rendering and settings
- **CSS** for styling (scoped to widget)
- **Vanilla JavaScript** for functionality
- **Shopify APIs** for customer data

### API Integration

**Hardcoded Credentials:**
```javascript
const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

**Endpoints Used:**
1. `get-widget-config` - Fetch widget configuration
2. `get-customer-rewards` - Fetch customer's available rewards

### Customer Detection

The widget uses Shopify's global variables:
```javascript
window.Shopify.shop           // Shop domain
window.Shopify.customerEmail  // Logged in customer email
```

## Styling Customization

### Colors

Edit the gradient in `blocks/rewards-widget.liquid`:

```css
/* Button gradient */
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

/* Change to your brand colors */
background: linear-gradient(135deg, #your-color-1 0%, #your-color-2 100%);
```

### Size

```css
/* Button size */
.rewardhub-widget-button {
  width: 60px;   /* Change width */
  height: 60px;  /* Change height */
}

/* Panel size */
.rewardhub-widget-panel {
  width: 380px;  /* Change width */
}
```

### Position Offsets

```css
/* Bottom right position */
.rewardhub-widget[data-position="bottom-right"] {
  bottom: 20px;  /* Distance from bottom */
  right: 20px;   /* Distance from right */
}
```

## Testing

### 1. Test in Theme Editor

1. Enable app embed
2. Configure widget
3. Click **Preview** (eye icon)
4. Check widget appears in correct position
5. Click button to open panel
6. Test on mobile preview

### 2. Test with Customer Account

1. Create test customer account
2. Allocate some rewards to customer
3. Login on storefront
4. Visit any page
5. Widget should show badge count
6. Click to see rewards
7. Test claim button

### 3. Test States

**Test Not Logged In:**
- Open incognito browser
- Visit store
- Click widget
- Should show "Sign in" message

**Test No Rewards:**
- Login as customer with no rewards
- Click widget
- Should show "No rewards available"

**Test With Rewards:**
- Login as customer with rewards
- Click widget
- Should show reward cards
- Badge should show count

## Troubleshooting

### Widget Not Appearing

**Check 1: App Embed Enabled**
- Go to Theme Customizer
- Check App embeds section
- Ensure toggle is ON

**Check 2: Widget ID**
- Verify exact spelling
- Check in dashboard
- No extra spaces

**Check 3: Extension Deployed**
```bash
shopify app versions list
```

### Badge Not Showing Count

**Check 1: Customer Logged In**
- Badge only shows for logged in customers
- Check `window.Shopify.customerEmail`

**Check 2: Rewards Exist**
```sql
SELECT * FROM reward_allocations
WHERE customer_id = (
  SELECT id FROM customers WHERE email = 'customer@example.com'
)
AND quantity > redeemed_count;
```

**Check 3: Function Deployed**
```bash
supabase functions list
```

### Panel Content Not Loading

**Check 1: Network Tab**
- Open browser DevTools
- Check Network tab
- Look for failed requests

**Check 2: Console Errors**
- Check Console tab
- Look for JavaScript errors

**Check 3: Function Logs**
```bash
supabase functions logs get-customer-rewards
```

## Mobile Optimization

The widget is mobile-responsive by default:

**Automatic Adjustments:**
- Panel width adapts to screen
- Touch-friendly button size
- Scrollable content area
- Proper spacing for thumbs

**Mobile-Specific Settings:**
- Can be hidden on mobile via `show_on_mobile` setting
- Panel uses `calc(100vw - 40px)` for width
- Max height prevents overflow

## Performance

**Optimizations:**
- Lazy loads rewards on button click
- Debounced API calls
- Cached widget config
- Minimal DOM manipulation
- No external dependencies

**Load Time:**
- Initial: < 1KB (button only)
- Full: < 5KB (with panel)
- Async API calls don't block rendering

## Security

**What's Safe:**
- Supabase anon key is public (by design)
- RLS policies protect data
- Only customer's own rewards visible
- Redemption tokens are single-use

**What's Protected:**
- Customer data via RLS
- Reward allocations via RLS
- Redemption links expire
- Service role key never exposed

## Analytics

The widget tracks:
- **Views** - When panel is opened
- **Clicks** - When rewards are claimed
- **Conversions** - When redemption is completed

View analytics in dashboard:
```sql
SELECT
  widget_id,
  COUNT(*) FILTER (WHERE event_type = 'view') as views,
  COUNT(*) FILTER (WHERE event_type = 'click') as clicks
FROM widget_analytics
WHERE widget_config_id = 'your-config-id'
GROUP BY widget_id;
```

## Advanced Customization

### Add Custom Animations

```css
@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.rewardhub-widget-panel.active {
  animation: slideIn 0.3s ease-out;
}
```

### Add Sound Effects

```javascript
function playSound() {
  const audio = new Audio('/path/to/sound.mp3');
  audio.volume = 0.3;
  audio.play();
}

button.addEventListener('click', function() {
  playSound();
  panel.classList.toggle('active');
});
```

### Add Confetti on Claim

```javascript
// Use a library like canvas-confetti
function celebrateReward() {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 }
  });
}
```

## Support

For issues or questions:
1. Check this README
2. Review console errors
3. Check function logs
4. Verify widget configuration
5. Test in incognito mode

## Changelog

**v1.0.0** - Initial release
- Floating button widget
- Expandable panel
- Customer rewards display
- Configurable positioning
- Mobile responsive
- Auto-open option

---

**Ready to engage your customers!** 🎉
