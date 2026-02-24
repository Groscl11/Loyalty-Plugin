# Rewards Cart Widget

**Type:** Cart UI Extension
**Target:** Cart Drawer / Cart Page
**Shopify Compliance:** 2024-2025 ✓

## Merchant Installation

1. Go to **Online Store → Themes → Customize**
2. Navigate to **Cart** section or **Cart Drawer**
3. Click **Add Block** or **Add App Block**
4. Select **"Rewards Cart Widget"**
5. Enter your **Widget ID**
6. Choose position (top or bottom of cart)
7. Click **Save**

## Features

- Native Shopify cart UI components
- Read-only (no cart mutation - App Store compliant)
- Shows available rewards based on cart value
- Customer-specific messaging when logged in
- Responsive design
- CTA button to view/claim rewards

## How It Works

1. Calculates current cart value
2. Fetches available rewards for customer
3. Displays reward preview card
4. Customer can click to view details or claim

## Important: Read-Only

This extension is **informational only**:
- Does NOT modify cart
- Does NOT apply discounts automatically
- Does NOT change prices
- Does NOT block checkout

This ensures App Store compliance.

## Use Cases

- Show rewards customer can earn with purchase
- Promote membership program
- Display available vouchers
- Encourage larger orders with reward tiers

## Developer Notes

- Built with React + Cart UI Extensions
- Access to cart lines and total value
- Network requests allowed
- TODO: Configure API endpoint
- TODO: Add authentication
