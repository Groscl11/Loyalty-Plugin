# Loyalty Widget App Block

A Shopify theme app extension that adds a customizable loyalty widget to your storefront. No manual code editing required!

## Installation

1. **Install the App** on your Shopify store
2. **Navigate to Theme Customizer**:
   - Go to **Online Store** → **Themes**
   - Click **Customize** on your active theme
3. **Add the App Block**:
   - Click **Add app block** in the theme editor
   - Select **Loyalty Widget** from the app blocks list
   - The widget will automatically appear on your store

## Features

- **Floating Widget**: Shows customer points balance and available rewards
- **Auto-Registration**: Customers can register directly from the widget
- **Customizable Position**: Choose from 4 corner positions
- **Brand Colors**: Match your store's color scheme
- **Auto Popup**: Optional first-visit popup to engage customers
- **Mobile Responsive**: Optimized for all screen sizes

## Configuration Options

Access these settings in the theme customizer after adding the app block:

### Display Settings
- **Show Widget**: Toggle widget visibility
- **Widget Position**: Bottom-right, bottom-left, top-right, or top-left
- **Primary Color**: Main widget color
- **Secondary Color**: Accent color for buttons and highlights

### Content Settings
- **Welcome Text**: Customize the greeting message
- **Auto Popup**: Enable automatic popup on first visit
- **Popup Delay**: Set delay before auto popup (0-30 seconds)

## How It Works

1. **Automatic Detection**: Widget detects the shop domain and loads configuration
2. **Customer Recognition**: If customer is logged in, displays their points balance
3. **Guest Mode**: Non-logged-in visitors can register or view general rewards info
4. **Real-time Updates**: Points and rewards update automatically after purchases

## Widget Features

### For Logged-In Customers
- View current points balance
- See available rewards
- Redeem rewards for discount codes
- Track order history and earned points
- Update loyalty preferences

### For Guests
- Register for loyalty program
- View program benefits
- See sample rewards
- Learn about point earning rules

## Customization

### Theme Customizer
All visual customization can be done directly in the Shopify theme customizer without touching any code:
- Colors
- Position
- Welcome message
- Auto-popup behavior

### Advanced Customization
For advanced customization, you can add CSS to your theme:

```css
/* Custom styling for loyalty widget */
#rewardhub-loyalty-widget {
  /* Your custom styles */
}
```

## Troubleshooting

**Widget not appearing?**
- Ensure "Show Widget" is checked in theme settings
- Check that the app is installed and active
- Clear browser cache and refresh

**Widget showing but empty?**
- Verify the app has proper permissions
- Check that webhooks are registered in the app dashboard
- Ensure loyalty program is active

**Styling conflicts?**
- Check z-index (widget uses z-index: 999999)
- Verify no theme CSS is overriding widget styles
- Try adjusting widget position in settings

## Support

For help with the loyalty widget:
1. Check the main app dashboard for status
2. View webhook logs to ensure data is syncing
3. Contact support through the app

## Technical Details

**Loading Method**: Asynchronous script loading for zero impact on page load speed

**Data Handling**: All customer data is securely stored in your Supabase instance

**Performance**: Widget is optimized for minimal performance impact
- Async loading
- Cached configuration
- Lazy loading of reward data

**Compatibility**: Works with all modern Shopify themes

## Updates

The widget automatically updates when you deploy new versions through the app. No action required from merchants.

## Best Practices

1. **Test First**: Test the widget on a development theme before going live
2. **Choose Position Carefully**: Consider mobile viewport when positioning
3. **Brand Colors**: Use colors that match your store for cohesive experience
4. **Auto Popup**: Use sparingly to avoid annoying customers
5. **Monitor Performance**: Check analytics to see engagement rates

## Advanced Features

### Integration with Campaigns
The widget automatically displays:
- Active campaign rewards
- Special offers
- Time-limited promotions
- Personalized recommendations

### Multi-Language Support
Widget text can be customized for different languages through the app dashboard.

### Analytics Tracking
All widget interactions are tracked:
- Opens/closes
- Registrations
- Redemptions
- Click-through rates

Access these metrics in the app dashboard under Analytics.
