import React, { useState, useEffect } from 'react';
import { reactExtension, BlockStack, InlineStack, Text, Button, Link, Divider, Banner, useShop, useSettings, useEmail, useTotalAmount, useOrder } from '@shopify/ui-extensions-react/checkout';

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

export default reactExtension('purchase.thank-you.block.render', () => <PointsEarnedWidget />);

function PointsEarnedWidget() {
  let shop, settings, hookEmail, totalAmount, order;
  try { shop = useShop(); } catch(e) { shop = null; }
  try { settings = useSettings(); } catch(e) { settings = null; }
  try { hookEmail = useEmail(); } catch(e) { hookEmail = ''; }
  try { totalAmount = useTotalAmount(); } catch(e) { totalAmount = null; }
  try { order = useOrder(); } catch(e) { order = null; }

  const shopDomain = shop ? shop.myshopifyDomain : '';
  const customerEmail = hookEmail || '';
  const headingText = settings && settings.heading_text ? settings.heading_text : 'Points Earned on This Order';
  const orderTotal = totalAmount ? parseFloat(totalAmount.amount) || 0 : 0;
  const orderId = order && order.id ? String(order.id).split('/').pop() : '';

  const [memberLoaded, setMemberLoaded] = useState(false);
  const [estimatedPoints, setEstimatedPoints] = useState(0);
  const [pointsName, setPointsName] = useState('Points');
  const [rewardData, setRewardData] = useState(null);

  // Fetch loyalty points status
  useEffect(function() {
    if (!shopDomain || !customerEmail) return;
    fetch(
      SUPABASE_URL + '/functions/v1/get-loyalty-status?email=' + encodeURIComponent(customerEmail) + '&shop_domain=' + encodeURIComponent(shopDomain),
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }
    ).then(function(r) { return r.json(); }).then(function(data) {
      if (data && !data.error) {
        var rate = data.tier && data.tier.points_earn_rate != null ? data.tier.points_earn_rate : 1;
        var divisor = data.tier && data.tier.points_earn_divisor != null ? data.tier.points_earn_divisor : 1;
        setEstimatedPoints(divisor > 0 ? Math.floor((orderTotal / divisor) * rate) : 0);
        setPointsName(data.program && data.program.points_name ? data.program.points_name : 'Points');
        setMemberLoaded(true);
      }
    }).catch(function() {});
  }, [customerEmail, shopDomain, orderTotal]);

  // Fetch campaign reward token
  useEffect(function() {
    if (!shopDomain) return;
    var url = SUPABASE_URL + '/functions/v1/get-order-token' +
      '?shop=' + encodeURIComponent(shopDomain) +
      (orderId ? '&order_id=' + encodeURIComponent(orderId) : '') +
      (customerEmail ? '&customer_email=' + encodeURIComponent(customerEmail) : '');
    fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } })
      .then(function(r) { return r.json(); })
      .then(function(data) { if (data && data.has_reward) setRewardData(data); })
      .catch(function() {});
  }, [shopDomain]);

  return (
    <BlockStack spacing='base'>
      {memberLoaded ? (
        <BlockStack spacing='tight'>
          <Divider />
          <Text size='small' appearance='subdued'>{headingText}</Text>
          <Text size='large' emphasis='bold'>You will earn {estimatedPoints} {pointsName}</Text>
          <Text size='small' appearance='subdued'>{pointsName} will be rewarded once order is fulfilled</Text>
        </BlockStack>
      ) : (
        <Banner status='warning' title='Earn Points on This Order'>
          <BlockStack spacing='tight'>
            <Text>Login to earn {pointsName} on this order and all future purchases</Text>
            {shopDomain ? <Text size='small'>{'Login at https://' + shopDomain + '/account/login'}</Text> : null}
          </BlockStack>
        </Banner>
      )}
      {rewardData && (
        <BlockStack spacing='tight'>
          <Divider />
          <InlineStack blockAlignment='center' spacing='base'>
            <Text size='large'>🎁</Text>
            <BlockStack spacing='extraTight' inlineSize='fill'>
              <Text emphasis='bold'>
                {rewardData.customer_first_name ? 'Dear, ' + rewardData.customer_first_name + '.' : 'Dear Customer,'}
              </Text>
              <Text appearance='subdued' size='small'>
                {rewardData.campaign_name
                  ? 'You have rewards waiting from “' + rewardData.campaign_name + '”!'
                  : 'You have exclusive rewards waiting for you!'}
              </Text>
            </BlockStack>
            <Link to={rewardData.claim_url} external>
              <Button kind='primary'>Claim Your Rewards</Button>
            </Link>
          </InlineStack>
        </BlockStack>
      )}
    </BlockStack>
  );
}
