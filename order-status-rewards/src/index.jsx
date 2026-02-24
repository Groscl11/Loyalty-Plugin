import React, { useState, useEffect } from 'react';
import {
  reactExtension,
  Banner,
  Button,
  BlockStack,
  Text,
  Divider,
  useApi,
  useSettings,
} from '@shopify/ui-extensions-react/checkout';

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

export default reactExtension(
  'purchase.order-status.block.render',
  () => <OrderStatusRewards />
);

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
