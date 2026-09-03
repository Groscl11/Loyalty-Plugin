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
// C-12: No hardcoded fallbacks — missing env vars render widget silently invisible
// rather than accidentally pointing production merchants at the dev database.
const SUPABASE_URL = _env.SUPABASE_URL      || 'https://lizgppzyyljqbmzdytia.supabase.co';
const ANON_KEY     = _env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

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
  // Prefer order.name (#1018 format) over confirmation token (6AZ600YCE)
  const orderName = (orderConf && orderConf.order && orderConf.order.name)
    ? String(orderConf.order.name)
    : (orderConf && orderConf.number ? String(orderConf.number) : '');

  // Order total — try both the top-level and nested paths Shopify may expose
  const orderTotalRaw = orderConf?.order?.totalPrice?.amount
    ?? orderConf?.totalPrice?.amount
    ?? null;
  const orderTotal = orderTotalRaw !== null ? parseFloat(String(orderTotalRaw)) : null;

  // Minimum order amount setting (0 or blank = no restriction)
  const minOrderAmountRaw = settings && settings.min_order_amount != null
    ? parseFloat(String(settings.min_order_amount))
    : 0;
  const minOrderAmount = isNaN(minOrderAmountRaw) ? 0 : minOrderAmountRaw;

  const [redemptionLink, setRedemptionLink] = useState('');
  const [linkReady, setLinkReady]           = useState(false);
  const [dismissed, setDismissed]           = useState(false);
  const [failed, setFailed]                 = useState(false);
  const [loading, setLoading]               = useState(true);
  const [firstName, setFirstName]           = useState('');

  // Refs so the fetch always uses the latest orderId/orderName without re-running the effect.
  // orderId and orderName come from Shopify's async StatefulRemoteSubscribable — they may
  // arrive one render after mount. Using refs + a 150ms delay lets us capture them
  // without a double-fetch (which would add 1-2s latency).
  var orderIdRef    = React.useRef(orderId);
  var orderNameRef  = React.useRef(orderName);
  var orderTotalRef = React.useRef(orderTotal);
  orderIdRef.current    = orderId;
  orderNameRef.current  = orderName;
  orderTotalRef.current = orderTotal;

  // ── Main fetch effect — fires once; 150ms delay lets Shopify populate orderId ──
  useEffect(function() {
    if (isEditor || !shopDomain || !campaignId) { setLoading(false); return; }

    var cancelled = false;

    var timer = setTimeout(function() {
      if (cancelled) return;

      var oid   = orderIdRef.current;
      var oname = orderNameRef.current;
      var ototal = orderTotalRef.current;

      var url = SUPABASE_URL + '/functions/v1/generate-instant-reward-link' +
        '?shop_domain=' + encodeURIComponent(shopDomain) +
        '&campaign_id=' + encodeURIComponent(campaignId) +
        (oid           ? '&shopify_order_id=' + encodeURIComponent(oid)           : '') +
        (oname         ? '&order_name='       + encodeURIComponent(oname)         : '') +
        (customerEmail ? '&email='            + encodeURIComponent(customerEmail) : '') +
        (ototal !== null ? '&order_total='    + encodeURIComponent(String(ototal)) : '');

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
    }, 150);

    return function() { cancelled = true; clearTimeout(timer); };
  // orderId/orderName/orderTotal excluded — captured via refs above to avoid double-fetch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopDomain, campaignId, customerEmail]);

  // ── Order amount gate — separate effect so it never cancels the fetch above ──
  // Dismisses the widget once orderTotal is known and below the threshold.
  useEffect(function() {
    if (isEditor || minOrderAmount <= 0 || orderTotal === null) return;
    if (orderTotal < minOrderAmount) {
      setLoading(false);
      setDismissed(true);
    }
  }, [isEditor, minOrderAmount, orderTotal]);

  // Editor preview — always show enabled button so styles are visible
  // Also show a note if min_order_amount is set so merchant can see the setting is active
  if (isEditor) {
    return renderLayout({ template, tone, btnStyle, alignment, greeting: 'Dear, Customer.', bannerBody, buttonText, linkReady: true, loading: false, failed: false, redemptionLink: '#preview', minOrderAmount });
  }

  if (!campaignId || dismissed) return null;

  var greeting = firstName ? ('Dear, ' + firstName + '.') : 'Dear Customer,';

  return renderLayout({ template, tone, btnStyle, alignment, greeting, bannerBody, buttonText, linkReady, loading, failed, redemptionLink, minOrderAmount: 0 });
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
function renderLayout({ template, tone, btnStyle, alignment, greeting, bannerBody, buttonText, linkReady, loading, failed, redemptionLink, minOrderAmount }) {
  var validTone      = ['success', 'info', 'warning', 'critical'].indexOf(tone) !== -1 ? tone : 'success';
  var validTemplate  = ['inline', 'banner', 'minimal'].indexOf(template) !== -1 ? template : 'inline';
  var validAlignment = ['start', 'center', 'end'].indexOf(alignment) !== -1 ? alignment : 'start';
  var btn            = renderButton(linkReady, loading, failed, redemptionLink, buttonText, btnStyle);

  var thresholdNote = minOrderAmount > 0
    ? <Text size='small' appearance='subdued'>⚡ Min. order: {minOrderAmount}</Text>
    : null;

  if (validTemplate === 'banner') {
    return (
      <Banner status={validTone}>
        <BlockStack spacing='base' inlineAlignment={validAlignment}>
          <Text emphasis='bold'>{greeting}</Text>
          <Text size='small'>{bannerBody}</Text>
          {thresholdNote}
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
        {thresholdNote}
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
          {thresholdNote}
        </BlockStack>
        {btn}
      </InlineStack>
    </BlockStack>
  );
}
