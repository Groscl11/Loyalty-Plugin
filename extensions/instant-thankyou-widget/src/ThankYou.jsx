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
  useEmail,
  useApi,
  useSubscription,
  useExtensionEditor,
} from '@shopify/ui-extensions-react/checkout';

var EMPTY_SUBSCRIBABLE = Object.freeze({ current: null, subscribe: function() { return function() {}; } });

const _env = (function() { try { return process.env || {}; } catch(e) { return {}; } })();
const SUPABASE_URL = _env.SUPABASE_URL      || 'https://jblqyvicxhmqqjhostcj.supabase.co';
const ANON_KEY     = _env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibHF5dmljeGhtcXFqaG9zdGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTU1MTAsImV4cCI6MjA5Mjc3MTUxMH0.pMOn3TKgzp_QqJgOlMzwO7ZRRex-mifWUzhJPwxUndE';

export default reactExtension('purchase.thank-you.block.render', () => <InstantRewardBanner />);

function InstantRewardBanner() {
  let shop, settings, hookEmail, apiObj, editor;
  try { shop     = useShop();            } catch(e) { shop    = null; }
  try { settings = useSettings();        } catch(e) { settings = null; }
  try { hookEmail = useEmail();          } catch(e) { hookEmail = ''; }
  try { apiObj   = useApi();             } catch(e) { apiObj  = null; }
  try { editor   = useExtensionEditor(); } catch(e) { editor  = null; }

  var orderConf = useSubscription(apiObj && apiObj.orderConfirmation ? apiObj.orderConfirmation : EMPTY_SUBSCRIBABLE);

  const isEditor = !!editor;

  const shopDomain    = shop ? shop.myshopifyDomain : '';
  const campaignId    = settings && settings.campaign_id ? String(settings.campaign_id).trim() : '';
  const bannerBody    = settings && settings.banner_body
    ? String(settings.banner_body)
    : 'Grab your exclusive voucher and get up to 80% Off from our Partner brands.';
  const buttonText  = settings && settings.button_text ? String(settings.button_text) : 'Claim Now';
  const template    = settings && settings.template ? String(settings.template).toLowerCase().trim() : 'inline';
  const tone        = settings && settings.banner_tone ? String(settings.banner_tone).toLowerCase().trim() : 'success';
  const btnStyle    = settings && settings.button_style ? String(settings.button_style).toLowerCase().trim() : 'primary';
  const alignment   = settings && settings.text_alignment ? String(settings.text_alignment).toLowerCase().trim() : 'start';
  const customerEmail = hookEmail || '';

  const orderId   = orderConf && orderConf.order && orderConf.order.id
    ? String(orderConf.order.id).split('/').pop() || ''
    : '';
  const orderName = orderConf && orderConf.number ? String(orderConf.number) : '';

  const [redemptionLink, setRedemptionLink] = useState('');
  const [linkReady, setLinkReady]           = useState(false);
  const [dismissed, setDismissed]           = useState(false);
  const [failed, setFailed]                 = useState(false);
  const [loading, setLoading]               = useState(true);
  const [firstName, setFirstName]           = useState('');

  useEffect(function() {
    if (isEditor || !shopDomain || !campaignId) { setLoading(false); return; }

    var cancelled = false;

    var url = SUPABASE_URL + '/functions/v1/generate-instant-reward-link' +
      '?shop_domain=' + encodeURIComponent(shopDomain) +
      '&campaign_id=' + encodeURIComponent(campaignId) +
      (orderId       ? '&shopify_order_id=' + encodeURIComponent(orderId)       : '') +
      (orderName     ? '&order_name='       + encodeURIComponent(orderName)     : '') +
      (customerEmail ? '&email='            + encodeURIComponent(customerEmail) : '');

    fetch(url, { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY } })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (cancelled) return;
        setLoading(false);
        if (data && data.has_rewards && data.redemption_link) {
          setRedemptionLink(data.redemption_link);
          if (data.customer_first_name) setFirstName(data.customer_first_name);
          setLinkReady(true);
        } else if (data && data.has_rewards === false) {
          setDismissed(true);
        } else {
          setFailed(true);
        }
      })
      .catch(function() {
        if (cancelled) return;
        setLoading(false);
        setFailed(true);
      });

    return function() { cancelled = true; };
  }, [shopDomain, campaignId, orderId, orderName, customerEmail]);

  // Editor preview — always show enabled button so styles are visible
  if (isEditor) {
    return renderLayout({ template, tone, btnStyle, alignment, greeting: 'Dear, Customer.', bannerBody, buttonText, linkReady: true, loading: false, failed: false, redemptionLink: '#preview' });
  }

  if (!campaignId || dismissed) return null;

  var greeting = firstName ? ('Dear, ' + firstName + '.') : 'Dear Customer,';

  return renderLayout({ template, tone, btnStyle, alignment, greeting, bannerBody, buttonText, linkReady, loading, failed, redemptionLink });
}

// ── Button / loading helper ──────────────────────────────────────────────────
function renderButton(linkReady, loading, failed, redemptionLink, buttonText, btnStyle) {
  var kind = ['primary', 'secondary', 'plain'].indexOf(btnStyle) !== -1 ? btnStyle : 'primary';

  if (linkReady) {
    return (
      <Link to={redemptionLink} external>
        <Button kind={kind}>{buttonText}</Button>
      </Link>
    );
  }

  if (loading) {
    return (
      <BlockStack spacing='extraTight'>
        <Text size='small' appearance='subdued'>Checking your reward...</Text>
        <Button kind={kind} disabled={true}>{buttonText}</Button>
      </BlockStack>
    );
  }

  if (failed) {
    return (
      <BlockStack spacing='extraTight'>
        <Text size='small' appearance='subdued'>Your reward is on its way.</Text>
        <Text size='small' appearance='subdued'>You will receive a claim link shortly.</Text>
      </BlockStack>
    );
  }

  return <Button kind={kind} disabled={true}>{buttonText}</Button>;
}

// ── Layout renderer ──────────────────────────────────────────────────────────
function renderLayout({ template, tone, btnStyle, alignment, greeting, bannerBody, buttonText, linkReady, loading, failed, redemptionLink }) {
  var validTone      = ['success', 'info', 'warning', 'critical'].indexOf(tone) !== -1 ? tone : 'success';
  var validTemplate  = ['inline', 'banner', 'minimal'].indexOf(template) !== -1 ? template : 'inline';
  var validAlignment = ['start', 'center', 'end'].indexOf(alignment) !== -1 ? alignment : 'start';
  var btn            = renderButton(linkReady, loading, failed, redemptionLink, buttonText, btnStyle);

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

  // Inline (default)
  return (
    <BlockStack spacing='tight' inlineAlignment={validAlignment}>
      <Divider />
      <InlineStack blockAlignment='center' spacing='base'>
        <Text size='large'>⚡</Text>
        <BlockStack spacing='extraTight' inlineSize='fill'>
          <Text emphasis='bold'>{greeting}</Text>
          <Text appearance='subdued' size='small'>{bannerBody}</Text>
        </BlockStack>
        {btn}
      </InlineStack>
    </BlockStack>
  );
}
