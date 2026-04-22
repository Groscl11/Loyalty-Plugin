/**
 * Show Points Earned On This Order — Order Status Page
 * Logged-in: shows estimated points for the current order.
 * Guest: shows a login prompt to view referral link.
 */

import React, { useState, useEffect } from 'react';
import {
  reactExtension,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Link,
  Divider,
  useApi,
  useSettings,
} from '@shopify/ui-extensions-react/checkout';

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

export default reactExtension(
  'purchase.order-status.block.render',
  () => <PointsEarnedWidget />
);

function PointsEarnedWidget() {
  const { order, shop } = useApi();
  const settings = useSettings();

  const [status, setStatus] = useState('loading'); // 'loading' | 'guest' | 'loaded' | 'error'
  const [estimatedPoints, setEstimatedPoints] = useState(0);
  const [pointsName, setPointsName] = useState('Points');

  const headingText = settings.heading_text || 'Points Earned on This Order';
  const referralRewardText = settings.referral_reward_text || 'bonus rewards';

  const customerEmail = order?.customer?.email;
  const shopDomain = shop?.myshopifyDomain;
  const loginUrl = `https://${shopDomain}/account/login`;

  // Order total (strip currency, parse as float)
  const rawAmount = order?.totalPrice?.amount ?? order?.subtotalPrice?.amount ?? '0';
  const orderTotal = parseFloat(typeof rawAmount === 'object' ? rawAmount.amount ?? 0 : rawAmount) || 0;

  useEffect(() => {
    if (!customerEmail) {
      setStatus('guest');
      return;
    }
    loadLoyaltyStatus();
  }, []);

  async function loadLoyaltyStatus() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/get-loyalty-status?email=${encodeURIComponent(customerEmail)}&shop_domain=${encodeURIComponent(shopDomain)}`,
        { headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      const data = await res.json();

      if (data.error) {
        setStatus('error');
        return;
      }

      const earnRate = data.tier?.points_earn_rate ?? 1;
      const earnDivisor = data.tier?.points_earn_divisor ?? 1;
      const name = data.program?.points_name || 'Points';

      const pts = Math.floor((orderTotal / earnDivisor) * earnRate);
      setEstimatedPoints(pts);
      setPointsName(name);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'loading') return null;
  if (status === 'error') return null;

  // ── Guest View ────────────────────────────────────────────────────────────
  if (status === 'guest') {
    return (
      <Banner status="warning">
        <BlockStack spacing="tight">
          <Text>
            <Link to={loginUrl} external>Login</Link>
            {` to view your referral link and earn ${referralRewardText} on every successful referral`}
          </Text>
        </BlockStack>
      </Banner>
    );
  }

  // ── Logged-in View ────────────────────────────────────────────────────────
  return (
    <BlockStack spacing="base">
      <Divider />
      <BlockStack spacing="tight">
        <Text size="small" appearance="subdued">{headingText}</Text>
        <Text size="large" emphasis="bold">
          You will earn {estimatedPoints} {pointsName}
        </Text>
        <Text size="small" appearance="subdued">
          {pointsName} will be rewarded once order is paid
        </Text>
      </BlockStack>
    </BlockStack>
  );
}


function OrderStatusRewards() {
  const { order, shop } = useApi();
  const settings = useSettings();
  const [widgetData, setWidgetData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const widgetId = settings.widget_id;

  useEffect(() => {
    if (!widgetId) {
      setLoading(false);
      return;
    }
    fetchRewardLink();
  }, [widgetId]);

  const fetchRewardLink = async () => {
    try {
      setLoading(true);

      // Use get-order-reward-link — correct public endpoint with retry
      const orderId = order?.id?.toString().replace('gid://shopify/Order/', '');
      const customerEmail = order?.customer?.email;

      if (!orderId || !customerEmail) { setLoading(false); return; }

      const fetchWithRetry = async (attempt = 0) => {
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/get-order-reward-link`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              order_id: orderId,
              customer_email: customerEmail,
              shop_domain: shop.myshopifyDomain,
            }),
          }
        );
        const data = await response.json();
        if (data.has_rewards) {
          setWidgetData(data);
        } else if (data.reason === 'not_yet' && attempt < 5) {
          setTimeout(() => fetchWithRetry(attempt + 1), 2000);
          return;
        }
        setLoading(false);
      };
      await fetchWithRetry();
    } catch (err) {
      console.error('Error fetching reward link:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return null;
  }

  if (error || !widgetData || !widgetData.has_rewards) {
    return null;
  }

  const rewardCount = widgetData.rewards?.length || 0;
  const rewardLink = widgetData.redemption_url;

  const handleButtonClick = async () => {
    // Track click event
    if (widgetData.widget_config_id) {
      try {
        await fetch(
          `${SUPABASE_URL}/functions/v1/track-widget-event`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              widget_config_id: widgetData.widget_config_id,
              event_type: 'click',
              metadata: { action: 'view_rewards' },
            }),
          }
        );
      } catch (err) {
        console.error('Failed to track click:', err);
      }
    }

    // Open reward link in new tab
    if (typeof window !== 'undefined') {
      window.open(rewardLink, '_blank');
    }
  };

  return (
    <BlockStack spacing="base">
      <Divider />
      <Banner
        status="success"
        title={`🎉 You've earned ${rewardCount} reward${rewardCount !== 1 ? 's' : ''}!`}
      >
        <BlockStack spacing="base">
          <Text>
            Thank you for your purchase! Your loyalty rewards are ready to claim.
          </Text>
          {widgetData.rewards?.slice(0, 3).map((r, i) => (
            <Text key={i} size="small" appearance="subdued">• {r.title || r.campaign_name}</Text>
          ))}
          <Button kind="primary" to={rewardLink} onPress={handleButtonClick}>
            Claim Your Rewards →
          </Button>
        </BlockStack>
      </Banner>
    </BlockStack>
  );
}
