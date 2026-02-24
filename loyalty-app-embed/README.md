# Loyalty Bolt Widget - App Embed

This is a Shopify theme app embed that allows merchants to enable/disable the Loyalty Bolt widget from their theme customizer.

## How It Appears

- **Location:** Online Store → Themes → Customize → App embeds section
- **Type:** App embed (can be toggled ON/OFF)
- **Name:** "Loyalty Bolt Widget"

## What It Does

When enabled, this app embed loads the Loyalty Bolt floating widget on the storefront, which:
- Shows a floating button in the corner
- Opens a loyalty panel when clicked
- Allows customers to register, check points, and view rewards
- Tracks customer engagement

## Configuration

Merchants can configure:
- **Enable/Disable:** Toggle the widget on or off
- **Position:** Choose widget position (bottom-right, bottom-left, top-right, top-left)

## Technical Details

### Files
- `shopify.extension.toml` - Extension configuration
- `assets/loyalty-widget.js` - Widget loader script

### How It Works

1. The app embed injects JavaScript into the theme
2. JavaScript loads the widget script from Supabase edge function
3. Widget script creates the floating button and panel
4. Widget communicates with backend via API

### Widget Script URL
```
https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/widget-script?shop={shop_domain}
```

## Installation

After installing the Shopify app:

1. Go to **Online Store → Themes**
2. Click **Customize** on your active theme
3. Look for **App embeds** in the left sidebar (usually at the bottom)
4. Find "Loyalty Bolt Widget"
5. Toggle it **ON**
6. Click **Save**

The widget should now appear on your storefront!

## Troubleshooting

### App Embed Not Showing

If the app embed doesn't appear in the theme customizer:

1. Make sure the app is installed and active
2. Try refreshing the theme customizer
3. Check browser console for errors
4. Try a different browser or incognito mode

### Widget Not Appearing on Store

If you've enabled the app embed but don't see the widget:

1. Make sure you clicked "Save" in the theme customizer
2. Hard refresh your storefront (Ctrl+Shift+R or Cmd+Shift+R)
3. Check browser console for JavaScript errors
4. Verify the shop domain is correct

### Manual Installation Alternative

If app embeds don't work, you can manually add the widget by editing your theme:

1. Go to **Online Store → Themes → Actions → Edit code**
2. Open `theme.liquid`
3. Add before `</body>`:

```html
<script src="https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/widget-script?shop={{ shop.permanent_domain }}" async></script>
```

4. Click **Save**
