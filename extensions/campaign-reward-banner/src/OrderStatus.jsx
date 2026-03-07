import React, { useState, useEffect } from 'react';
import {
  reactExtension,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Link,
  Divider,
  useShop,
  useSettings,
  useOrder,
  useCustomer,
  useExtensionEditor,
} from '@shopify/ui-extensions-react/customer-account';

const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

export default reactExtension('customer-account.order-status.block.render', () => <CampaignRewardBannerOrderStatus />);

function CampaignRewardBannerOrderStatus() {
  let shop, settings, order, customer, editor;
  try { shop = useShop(); } catch(e) { shop = null; }
  try { settings = useSettings(); } catch(e) { settings = null; }
  try { order = useOrder(); } catch(e) { order = null; }
  try { customer = useCustomer(); } catch(e) { customer = null; }
  try { editor = useExtensionEditor(); } catch(e) { editor = null; }

  const isEditor = !!editor;

  const shopDomain  = shop ? shop.myshopifyDomain : '';
  const campaignId  = settings && settings.campaign_id ? String(settings.campaign_id).trim() : '';
  const bannerBody  = settings && settings.banner_body
    ? String(settings.banner_body)
    : 'Grab your exclusive voucher and get up to 80% Off from our Partner brands.';
  const buttonText  = settings && settings.button_text ? String(settings.button_text) : 'Claim Now';

  // customer-account: order.id is GID, order.name is the order name e.g. "BSC2002999942"
  const orderId = order && order.id ? String(order.id).split('/').pop() || '' : '';

  // customer object in customer-account surface
  const firstName = (customer && customer.firstName) ? customer.firstName : '';
  const customerEmail = (customer && customer.email) ? customer.email : '';

  const [rewardData, setRewardData] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(function() {
    // In editor/preview, skip fetch — show placeholder
    if (isEditor) { setChecked(true); return; }
    if (!shopDomain || !campaignId) {
      setChecked(true);
      return;
    }
    var url = SUPABASE_URL + '/functions/v1/get-campaign-reward-link' +
      '?shop_domain=' + encodeURIComponent(shopDomain) +
      '&campaign_id=' + encodeURIComponent(campaignId) +
      (orderId ? '&shopify_order_id=' + encodeURIComponent(orderId) : '') +
      (customerEmail ? '&email=' + encodeURIComponent(customerEmail) : '');

    fetch(url, { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY } })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.has_rewards) setRewardData(data);
      })
      .catch(function() {})
      .finally(function() { setChecked(true); });
  }, [shopDomain, campaignId]);

  // In editor: show sample banner so merchant can preview the layout
  if (isEditor) {
    var previewBody = (settings && settings.banner_body) ? String(settings.banner_body) : bannerBody;
    var previewBtn  = (settings && settings.button_text) ? String(settings.button_text) : buttonText;
    return (
      <BlockStack spacing='tight'>
        <Divider />
        <InlineStack blockAlignment='center' spacing='base'>
          <Text size='large'>🎁</Text>
          <BlockStack spacing='extraTight' inlineSize='fill'>
            <Text emphasis='bold'>Dear, Customer.</Text>
            <Text appearance='subdued' size='small'>{previewBody}</Text>
          </BlockStack>
          <Button kind='primary'>{previewBtn}</Button>
        </InlineStack>
      </BlockStack>
    );
  }

  if (!checked || !rewardData) return null;

  // Prefer name from customer hook; fallback to what edge fn returned
  var resolvedFirstName = firstName || rewardData.customer_first_name || '';
  var greeting = resolvedFirstName ? ('Dear, ' + resolvedFirstName + '.') : 'Dear Customer,';

  return (
    <BlockStack spacing='tight'>
      <Divider />
      <InlineStack blockAlignment='center' spacing='base'>
        <Text size='large'>🎁</Text>
        <BlockStack spacing='extraTight' inlineSize='fill'>
          <Text emphasis='bold'>{greeting}</Text>
          <Text appearance='subdued' size='small'>{bannerBody}</Text>
        </BlockStack>
        <Link to={rewardData.redemption_link} external>
          <Button kind='primary'>{buttonText}</Button>
        </Link>
      </InlineStack>
    </BlockStack>
  );
}
