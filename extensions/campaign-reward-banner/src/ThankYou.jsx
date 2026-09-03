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

// Fallback subscribable for when api is unavailable (editor / error states).
// Must be a module-level constant so useSubscription sees the same reference
// every render and doesn't trigger unnecessary re-subscriptions.
var EMPTY_SUBSCRIBABLE = Object.freeze({ current: null, subscribe: function() { return function() {}; } });

const _env = (function() { try { return process.env || {}; } catch(e) { return {}; } })();
// C-12: No hardcoded fallbacks — missing env vars render widget silently invisible
const SUPABASE_URL = _env.SUPABASE_URL      || 'https://jblqyvicxhmqqjhostcj.supabase.co';
const ANON_KEY     = _env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibHF5dmljeGhtcXFqaG9zdGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTU1MTAsImV4cCI6MjA5Mjc3MTUxMH0.pMOn3TKgzp_QqJgOlMzwO7ZRRex-mifWUzhJPwxUndE';

export default reactExtension('purchase.thank-you.block.render', () => <CampaignRewardBanner />);

function CampaignRewardBanner() {
  let shop, settings, hookEmail, apiObj, editor;
  try { shop     = useShop();            } catch(e) { shop    = null; }
  try { settings = useSettings();        } catch(e) { settings = null; }
  try { hookEmail = useEmail();          } catch(e) { hookEmail = ''; }
  try { apiObj   = useApi();             } catch(e) { apiObj  = null; }
  try { editor   = useExtensionEditor(); } catch(e) { editor  = null; }

  // ── OrderConfirmationApi — always resolves for ALL checkout types ───────────
  // orderConfirmation.order.id  : Shopify GID (always set)
  // orderConfirmation.number    : "#1093" display name (always set for 2024+ orders)
  // This replaces the unreliable useOrder() hook which fails for guest/phone-only
  // checkouts because it requires an authenticated customer context.
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
  // Extract numeric order ID from the GID (e.g. "gid://shopify/Order/6931643597026" → "6931643597026")
  const orderId   = orderConf && orderConf.order && orderConf.order.id
    ? String(orderConf.order.id).split('/').pop() || ''
    : '';
  // orderConf.number is the "#1093" display name — at the OrderConfirmation level (not order.number)
  const orderName = orderConf && orderConf.number ? String(orderConf.number) : '';

  const [redemptionLink, setRedemptionLink] = useState('');
  const [linkReady, setLinkReady]           = useState(false);
  const [dismissed, setDismissed]           = useState(false);
  const [gaveUp, setGaveUp]                 = useState(false);
  const [firstName, setFirstName]           = useState('');

  useEffect(function() {
    if (isEditor || !shopDomain || !campaignId) return;

    // Always start polling — useOrder() may resolve AFTER mount for phone-only
    // guest orders. Each attempt uses the identifiers captured in this closure.
    // When useOrder() eventually resolves (orderName / customerPhone change),
    // React re-runs this effect with the new values so the next poll has them.
    // If no identifier is present the edge fn returns pending; after max retries
    // we fall into the gaveUp state so the button never stays disabled silently.

    var cancelled = false;

    var url = SUPABASE_URL + '/functions/v1/get-campaign-reward-link' +
      '?shop_domain=' + encodeURIComponent(shopDomain) +
      '&campaign_id=' + encodeURIComponent(campaignId) +
      (orderId       ? '&shopify_order_id=' + encodeURIComponent(orderId)       : '') +
      (orderName     ? '&order_name='       + encodeURIComponent(orderName)     : '') +
      (customerEmail ? '&email='            + encodeURIComponent(customerEmail) : '');

    var attempt = 0;
    // Webhook takes 3-11s (avg ~6s). Uniform 1s polling catches it within
    // 1s of completion across the full range, vs exponential backoff which
    // can miss by 4-5s. 13 attempts over 12s = same total window, ~4s faster
    // median response. No backend impact — pending responses are <300ms each.
    var retryDelays = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
    var maxAttempts = retryDelays.length + 1;

    function tryFetch() {
      attempt++;
      fetch(url, { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (cancelled) return;
          if (data && data.has_rewards && data.redemption_link) {
            setRedemptionLink(data.redemption_link);
            if (data.customer_first_name) setFirstName(data.customer_first_name);
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
          if (cancelled) return;
          if (attempt < maxAttempts) {
            setTimeout(tryFetch, retryDelays[attempt - 1] || 6000);
          } else {
            setGaveUp(true);
          }
        });
    }
    tryFetch();

    return function() { cancelled = true; };
  }, [shopDomain, campaignId, orderId, orderName, customerEmail]);

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
        <Text size='small' appearance='subdued'>You will receive a claim link shortly.</Text>
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

  // ── Banner: coloured card, full-width button ────────────────────────────────
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

  // ── Minimal: plain stacked text + button, no icon or card ──────────────────
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

  // ── Inline (default): icon + text + button in a row ────────────────────────
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
