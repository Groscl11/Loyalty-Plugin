/**
 * Cart Rewards Widget - Cart UI Extension
 * Shopify 2024-2025 Compliant
 *
 * Displays in cart drawer or cart page
 * Read-only messaging (no cart mutation)
 * Installed via: Theme Customizer → Cart → Add App Block
 */

import React, { useEffect, useState } from 'react';
import {
  reactExtension,
  Banner,
  Button,
  Text,
  BlockStack,
  InlineStack,
  useApi,
  useCartLines,
} from '@shopify/ui-extensions-react/checkout';

export default reactExtension('purchase.cart.block.render', () => <CartRewards />);

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

function CartRewards() {
  const { shop, buyerIdentity } = useApi();
  const cartLines = useCartLines();
  const [rewardInfo, setRewardInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const widgetId = settings.widget_id;

  useEffect(() => {
    if (!cartLines || cartLines.length === 0) {
      setLoading(false);
      return;
    }

    fetchRewardInfo();
  }, [cartLines]);

  async function fetchRewardInfo() {
    try {
      const cartValue = cartLines.reduce((t, l) => t + parseFloat(l.cost?.totalAmount?.amount || 0), 0);
      const customerEmail = buyerIdentity?.email;

      const shopDomain = shop?.myshopifyDomain;
      if (!shopDomain) { setLoading(false); return; }

      if (customerEmail) {
        // Logged in — show loyalty status + points to earn
        const res = await fetch(`https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/get-loyalty-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0'
          },
          body: JSON.stringify({ customer_email: customerEmail, shop_domain: shopDomain })
        });
        const data = await res.json();
        if (data.success) {
          const ptPerUnit = data.program?.points_per_currency_unit || 1;
          const mult = data.tier?.multiplier || 1;
          const toEarn = Math.floor(cartValue * ptPerUnit * mult);
          setRewardInfo({
            points_balance: data.points_balance,
            points_name: data.program?.points_name || 'Points',
            tier_name: data.tier?.name || 'Member',
            points_to_earn: toEarn,
            referral_code: data.referral_code,
          });
        }
      } else {
        // Guest — show teaser
        setRewardInfo({ guest: true });
      }
      setLoading(false);
    } catch (err) {
      console.error('Cart rewards error:', err);
      setLoading(false);
    }
  }

  if (loading || !rewardInfo) return null;

  if (rewardInfo.guest) {
    return (
      <BlockStack spacing="tight" border="base" padding="base" cornerRadius="base">
        <Text size="medium" emphasis="bold">🎁 Earn loyalty rewards with this order</Text>
        <Text size="small" appearance="subdued">Sign in to earn points and unlock rewards.</Text>
        <Button kind="secondary" to="/account/login">Sign in to earn rewards</Button>
      </BlockStack>
    );
  }

  return (
    <BlockStack spacing="tight" border="base" padding="base" cornerRadius="base">
      <InlineStack blockAlignment="center" spacing="tight">
        <Text size="medium" emphasis="bold">
          ⭐ {rewardInfo.points_balance?.toLocaleString()} {rewardInfo.points_name}
        </Text>
        <Text size="small" appearance="subdued">• {rewardInfo.tier_name}</Text>
      </InlineStack>
      {rewardInfo.points_to_earn > 0 && (
        <Text size="small" appearance="info">
          You'll earn +{rewardInfo.points_to_earn} {rewardInfo.points_name} with this order!
        </Text>
      )}
    </BlockStack>
  );
}
