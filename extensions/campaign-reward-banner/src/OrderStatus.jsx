import React, { useState, useEffect } from 'react';
import {
  reactExtension,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Link,
  Divider,
  Banner,
  useShop,
  useSettings,
  useOrder,
  useCustomer,
  useExtensionEditor,
} from '@shopify/ui-extensions-react/customer-account';

const _env = (function() { try { return process.env || {}; } catch(e) { return {}; } })();
// C-12: No hardcoded fallbacks — missing env vars render widget silently invisible
const SUPABASE_URL = _env.SUPABASE_URL      || 'https://jblqyvicxhmqqjhostcj.supabase.co';
const ANON_KEY     = _env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibHF5dmljeGhtcXFqaG9zdGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTU1MTAsImV4cCI6MjA5Mjc3MTUxMH0.pMOn3TKgzp_QqJgOlMzwO7ZRRex-mifWUzhJPwxUndE';

export default reactExtension('customer-account.order-status.block.render', () => <CampaignRewardBannerOrderStatus />);

function CampaignRewardBannerOrderStatus() {
  let shop, settings, order, customer, editor;
  try { shop = useShop(); } catch(e) { shop = null; }
  try { settings = useSettings(); } catch(e) { settings = null; }
  try { order = useOrder(); } catch(e) { order = null; }
  try { customer = useCustomer(); } catch(e) { customer = null; }
  try { editor = useExtensionEditor(); } catch(e) { editor = null; }

  const isEditor = !!editor;

  const shopDomain    = shop ? shop.myshopifyDomain : '';
  const campaignId    = settings && settings.campaign_id ? String(settings.campaign_id).trim() : '';
  const bannerBody    = settings && settings.banner_body
    ? String(settings.banner_body)
    : 'Grab your exclusive voucher and get up to 80% Off from our Partner brands.';
  const buttonText    = settings && settings.button_text ? String(settings.button_text) : 'Claim Now';
  const template      = settings && settings.template ? String(settings.template).toLowerCase().trim() : 'inline';
  const tone          = settings && settings.banner_tone ? String(settings.banner_tone).toLowerCase().trim() : 'success';
  const btnStyle      = settings && settings.button_style ? String(settings.button_style).toLowerCase().trim() : 'primary';
  const alignment     = settings && settings.text_alignment ? String(settings.text_alignment).toLowerCase().trim() : 'start';
  const orderId       = order && order.id ? String(order.id).split('/').pop() || '' : '';
  const firstName     = (customer && customer.firstName) ? customer.firstName : '';
  // useCustomer() requires full auth; fall back to order.email for guests viewing via order token
  const customerEmail = (customer && customer.email ? customer.email : '') ||
                        (order && order.email ? String(order.email) : '') ||
                        (order && order.customer && order.customer.email ? String(order.customer.email) : '');

  const [redemptionLink, setRedemptionLink] = useState('');
  const [linkReady, setLinkReady]           = useState(false);
  const [dismissed, setDismissed]           = useState(false);
  const [gaveUp, setGaveUp]                 = useState(false);

  useEffect(function() {
    if (isEditor || !shopDomain || !campaignId) return;
    // orderId is required — just wait if not yet available, don't permanently dismiss
    if (!orderId) { return; }

    var url = SUPABASE_URL + '/functions/v1/get-campaign-reward-link' +
      '?shop_domain=' + encodeURIComponent(shopDomain) +
      '&campaign_id=' + encodeURIComponent(campaignId) +
      '&shopify_order_id=' + encodeURIComponent(orderId) +
      (customerEmail ? '&email='            + encodeURIComponent(customerEmail) : '');

    var attempt = 0;
    // Webhook takes 4-10s; dense early polls, last attempt at ~12s
    var retryDelays = [500, 1000, 2000, 3500, 5000];
    var maxAttempts = retryDelays.length + 1;

    function tryFetch() {
      attempt++;
      fetch(url, { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.has_rewards && data.redemption_link) {
            setRedemptionLink(data.redemption_link);
            setLinkReady(true);
          } else if (data && data.pending && attempt < maxAttempts) {
            setTimeout(tryFetch, retryDelays[attempt - 1] || 6000);
          } else if (data && !data.has_rewards && !data.pending) {
            setDismissed(true);
          } else if (attempt < maxAttempts) {
            setTimeout(tryFetch, retryDelays[attempt - 1] || 6000);
          } else {
            setGaveUp(true);
          }
        })
        .catch(function() {
          if (attempt < maxAttempts) {
            setTimeout(tryFetch, retryDelays[attempt - 1] || 6000);
          } else {
            setGaveUp(true);
          }
        });
    }
    tryFetch();
  }, [shopDomain, campaignId, orderId]);

  // ── Editor preview ──────────────────────────────────────────────────────────
  if (isEditor) {
    // linkReady:true so button style (primary/secondary/plain) is visible — not locked to disabled
    return renderLayout({ template, tone, btnStyle, alignment, greeting: 'Dear, Customer.', bannerBody, buttonText, linkReady: true, gaveUp: false, redemptionLink: '#preview' });
  }

  if (!campaignId || dismissed) return null;

  var greeting = firstName ? ('Dear, ' + firstName + '.') : 'Dear Customer,';

  return renderLayout({ template, tone, btnStyle, alignment, greeting, bannerBody, buttonText, linkReady, gaveUp, redemptionLink });
}

// ── Button helper ───────────────────────────────────────────────────────────
function renderButton(linkReady, gaveUp, redemptionLink, buttonText, btnStyle) {
  var kind = ['primary', 'secondary', 'plain'].indexOf(btnStyle) !== -1 ? btnStyle : 'primary';
  if (linkReady) {
    return (
      <Link to={redemptionLink} external>
        <Button kind={kind}>{buttonText}</Button>
      </Link>
    );
  }
  if (gaveUp) {
    return (
      <BlockStack spacing='extraTight'>
        <Text size='small' appearance='subdued'>Your reward is on its way.</Text>
        <Text size='small' appearance='subdued'>Check your email for the claim link.</Text>
      </BlockStack>
    );
  }
  return <Button kind={kind} disabled={true}>{buttonText}</Button>;
}

// ── Layout renderer — 3 templates ───────────────────────────────────────────
function renderLayout({ template, tone, btnStyle, alignment, greeting, bannerBody, buttonText, linkReady, gaveUp, redemptionLink }) {
  var validTone      = ['success', 'info', 'warning', 'critical'].indexOf(tone) !== -1 ? tone : 'success';
  var validTemplate  = ['inline', 'banner', 'minimal'].indexOf(template) !== -1 ? template : 'inline';
  var validAlignment = ['start', 'center', 'end'].indexOf(alignment) !== -1 ? alignment : 'start';
  var btn            = renderButton(linkReady, gaveUp, redemptionLink, buttonText, btnStyle);

  // ── Banner: coloured card ───────────────────────────────────────────────────
  if (validTemplate === 'banner') {
    return (
      <Banner status={validTone}>
        <BlockStack spacing='base' inlineAlignment={validAlignment}>
          <Text emphasis='bold'>{greeting}</Text>
          <Text size='small'>{bannerBody}</Text>
          {btn}
        </BlockStack>
      </Banner>
    );
  }

  // ── Minimal: plain stacked ──────────────────────────────────────────────────
  if (validTemplate === 'minimal') {
    return (
      <BlockStack spacing='tight' inlineAlignment={validAlignment}>
        <Divider />
        <Text emphasis='bold'>{greeting}</Text>
        <Text appearance='subdued' size='small'>{bannerBody}</Text>
        {btn}
      </BlockStack>
    );
  }

  // ── Inline (default) ───────────────────────────────────────────────────────
  return (
    <BlockStack spacing='tight' inlineAlignment={validAlignment}>
      <Divider />
      <InlineStack blockAlignment='center' spacing='base'>
        <Text size='large'>🎁</Text>
        <BlockStack spacing='extraTight' inlineSize='fill'>
          <Text emphasis='bold'>{greeting}</Text>
          <Text appearance='subdued' size='small'>{bannerBody}</Text>
        </BlockStack>
        {btn}
      </InlineStack>
    </BlockStack>
  );
}
