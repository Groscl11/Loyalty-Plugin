# Order Status Rewards Extension

This Shopify UI extension displays a rewards notification on the Order Status page when customers qualify for rewards through campaign rules.

## Features

- Automatically checks if the order has qualified for rewards
- Displays a banner with reward information
- Provides a direct link to claim rewards
- Seamlessly integrates with Shopify's Order Status page

## How It Works

1. After an order is placed, the webhook processes campaign rules
2. If the customer qualifies for rewards, a redemption token is generated
3. The extension fetches the redemption link from the backend
4. A banner appears on the Order Status page with a "View My Rewards" button
5. Customers click the button to open the reward redemption portal

## Installation

This extension is automatically deployed with your Shopify app. No manual installation required.

## Configuration

The extension uses environment variables from your Supabase project:
- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous key

These are automatically configured when you deploy the extension.
