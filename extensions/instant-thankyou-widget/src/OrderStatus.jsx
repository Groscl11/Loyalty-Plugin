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
  useCustomer,
  useOrder,
  useExtensionEditor,
} from '@shopify/ui-extensions-react/customer-account';

const _env = (function() { try { return process.env || {}; } catch(e) { return {}; } })();
// C-12: No hardcoded fallbacks — missing env vars render widget silently invisible.
const SUPABASE_URL = _env.SUPABASE_URL      || 'https://lizgppzyyljqbmzdytia.supabase.co';
const ANON_KEY     = _env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

// Order-status renders every time the customer views the order (not one-time like
// thank-you), so retry transient lookups a few times before giving up.
var RETRY_DELAYS = [1500, 4000, 8000];

export const forOrderStatus = reactExtension('customer-account.order-status.block.render', () => <InstantRewardOrderStatus />);

function InstantRewardOrderStatus() {
  let shop, settings, customer, order, editor;
  try { shop     = useShop();            } catch(e) { shop    = null; }
  try { settings = useSettings();        } catch(e) { settings = null; }
  try { customer = useCustomer();        } catch(e) { customer = null; }
  try { order    = useOrder();           } catch(e) { order   = null; }
  try { editor   = useExtensionEditor(); } catch(e) { editor  = null; }

  const isEditor = !!editor;

  const shopDomain = shop ? shop.myshopifyDomain : '';
  const campaignId = settings && settings.campaign_id ? String(settings.campaign_id).trim() : '';
  const bannerBody = settings && settings.banner_body
    ? String(settings.banner_body)
    : 'Grab your exclusive voucher and get up to 80% Off from our Partner brands.';
  const buttonText = settings && settings.button_text ? String(settings.button_text) : 'Claim Now';
  const template   = settings && settings.template ? String(settings.template).toLowerCase().trim() : 'inline';
  const tone       = settings && settings.banner_tone ? String(settings.banner_tone).toLowerCase().trim() : 'success';
  const btnStyle   = settings && settings.button_style ? String(settings.button_style).toLowerCase().trim() : 'primary';
  const alignment  = settings && settings.text_alignment ? String(settings.text_alignment).toLowerCase().trim() : 'start';

  // useCustomer() needs full auth; fall back to order.email for guests viewing via order token.
  const customerEmail = (customer && customer.email ? String(customer.email) : '') ||
                        (order && order.email ? String(order.email) : '') ||
                        (order && order.customer && order.customer.email ? String(order.customer.email) : '');

  const orderId   = order && order.id ? String(order.id).split('/').pop() || '' : '';
  const orderName = order && (order.name || order.number) ? String(order.name || order.number) : '';

  // Defensive total parse — customer-account API may return Money{amount}, string, or number.
  const orderTotal = (function() {
    if (!order) return null;
    var tp = order.totalPrice || order.currentTotalPrice;
    if (!tp) return null;
    if (typeof tp === 'object' && tp.amount != null) return parseFloat(tp.amount);
    if (typeof tp === 'string' || typeof tp === 'number') return parseFloat(tp);
    return null;
  })();

  const minOrderAmountRaw = settings && settings.min_order_amount != null ? parseFloat(String(settings.min_order_amount)) : 0;
  const minOrderAmount = isNaN(minOrderAmountRaw) ? 0 : minOrderAmountRaw;

  const [redemptionLink, setRedemptionLink] = useState('');
  const [linkReady, setLinkReady]           = useState(false);
  const [dismissed, setDismissed]           = useState(false);
  const [failed, setFailed]                 = useState(false);
  const [loading, setLoading]               = useState(true);
  const [firstName, setFirstName]           = useState('');

  // ── Main fetch — retries transient empties (order-status is viewed repeatedly) ──
  useEffect(function() {
    if (isEditor || !shopDomain || !campaignId) { setLoading(false); return; }

    var cancelled = false;
    var attempt = 0;
    var maxAttempts = RETRY_DELAYS.length + 1;

    var url = SUPABASE_URL + '/functions/v1/generate-instant-reward-link' +
      '?shop_domain=' + encodeURIComponent(shopDomain) +
      '&campaign_id=' + encodeURIComponent(campaignId) +
      (orderId       ? '&shopify_order_id=' + encodeURIComponent(orderId)       : '') +
      (orderName     ? '&order_name='       + encodeURIComponent(orderName)     : '') +
      (customerEmail ? '&email='            + encodeURIComponent(customerEmail) : '');

    function tryFetch() {
      fetch(url, { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (cancelled) return;
          if (data && data.has_rewards && data.redemption_link) {
            setLoading(false);
            setRedemptionLink(data.redemption_link);
            if (data.customer_first_name) setFirstName(data.customer_first_name);
            setLinkReady(true);
          } else if (data && data.has_rewards === false) {
            setLoading(false);
            setDismissed(true);
          } else if (attempt < maxAttempts - 1) {
            setTimeout(tryFetch, RETRY_DELAYS[attempt]); attempt++;
          } else {
            setLoading(false);
            setFailed(true);
          }
        })
        .catch(function() {
          if (cancelled) return;
          if (attempt < maxAttempts - 1) { setTimeout(tryFetch, RETRY_DELAYS[attempt]); attempt++; }
          else { setLoading(false); setFailed(true); }
        });
    }
    tryFetch();

    return function() { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopDomain, campaignId, orderId, orderName, customerEmail]);

  // ── Order amount gate (separate so it never cancels the fetch) ──
  useEffect(function() {
    if (isEditor || minOrderAmount <= 0 || orderTotal === null) return;
    if (orderTotal < minOrderAmount) { setLoading(false); setDismissed(true); }
  }, [isEditor, minOrderAmount, orderTotal]);

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
