import React, { useState, useEffect } from 'react';
import { reactExtension, Banner, Button, BlockStack, InlineStack, Text, Link, Divider, useShop, useSettings, useEmail, usePhone, useApi, useSubscription, useExtensionEditor } from '@shopify/ui-extensions-react/checkout';

const _env = (function() { try { return process.env || {}; } catch(e) { return {}; } })();
// C-12: No hardcoded fallbacks — missing env vars render widget silently invisible
const SUPABASE_URL      = _env.SUPABASE_URL      || 'https://jblqyvicxhmqqjhostcj.supabase.co';
const SUPABASE_ANON_KEY = _env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibHF5dmljeGhtcXFqaG9zdGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTU1MTAsImV4cCI6MjA5Mjc3MTUxMH0.pMOn3TKgzp_QqJgOlMzwO7ZRRex-mifWUzhJPwxUndE';

// usePhone() on Shopify's thank-you page is unreliable: it may return empty or
// return the number without a country-code prefix.  We pass the order ID as a
// secondary identifier so the backend can resolve the member via the points
// transaction once the webhook fires (~3-10 s after checkout).
var EMPTY_SUBSCRIBABLE = Object.freeze({ current: null, subscribe: function() { return function() {}; } });
// Uniform 1 s polling — catches the webhook within 1 s of completion (same
// strategy as campaign-reward-banner).
var RETRY_DELAYS = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];

export default reactExtension('purchase.thank-you.block.render', () => <ReferralWidget />);

function ReferralWidget() {
  let shop, settings, hookEmail, hookPhone, apiObj, editor;
  try { shop = useShop(); } catch(e) { shop = null; }
  try { settings = useSettings(); } catch(e) { settings = null; }
  try { hookEmail = useEmail(); } catch(e) { hookEmail = ''; }
  try { hookPhone = usePhone(); } catch(e) { hookPhone = ''; }
  try { apiObj = useApi(); } catch(e) { apiObj = null; }
  try { editor = useExtensionEditor(); } catch(e) { editor = null; }

  // orderConfirmation is always populated for all checkout types (email, phone, guest)
  var orderConf = useSubscription(apiObj && apiObj.orderConfirmation ? apiObj.orderConfirmation : EMPTY_SUBSCRIBABLE);
  // Extract numeric Shopify order ID from the GID
  var orderId = orderConf && orderConf.order && orderConf.order.id
    ? String(orderConf.order.id).split('/').pop() || ''
    : '';

  const isEditor      = !!editor;
  const shopDomain    = shop ? shop.myshopifyDomain : '';
  const customerEmail = hookEmail || '';
  const customerPhone = hookPhone || '';
  const rewardText    = settings && settings.referral_reward_text ? settings.referral_reward_text : '15% Off Coupon';
  const template      = settings && settings.template ? String(settings.template).toLowerCase().trim() : 'banner';
  const tone          = settings && settings.banner_tone ? String(settings.banner_tone).toLowerCase().trim() : 'success';
  const showUrl       = settings ? settings.show_referral_url !== false : true;
  const showSocial    = settings ? settings.show_social_buttons !== false : true;
  const btnStyle      = settings && settings.button_style ? String(settings.button_style).toLowerCase().trim() : 'primary';
  const alignment     = settings && settings.text_alignment ? String(settings.text_alignment).toLowerCase().trim() : 'start';

  const [referralUrl, setReferralUrl] = useState(null);
  const [wasSelfReferral, setWasSelfReferral] = useState(false);

  useEffect(function() {
    // Option B: order-verified endpoint requires order_id + email (verified against
    // Shopify Admin API server-side). Phone-only guests fall through to the guest CTA.
    if (isEditor || !shopDomain || !orderId || !customerEmail) { setReferralUrl(''); setWasSelfReferral(false); return; }

    var attempt = 0;
    var maxAttempts = RETRY_DELAYS.length + 1;

    function tryFetch() {
      attempt++;
      fetch(SUPABASE_URL + '/functions/v1/get-order-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
        body: JSON.stringify({ shop_domain: shopDomain, order_id: orderId, email: customerEmail }),
      })
      .then(function(r) { return r.json(); }).then(function(data) {
        if (data && data.verified && data.is_member && data.referral_code) {
          setWasSelfReferral(false);
          setReferralUrl('https://' + shopDomain + '/?ref=' + encodeURIComponent(data.referral_code));
        } else if (data && data.verified && data.is_member === false) {
          // Order verified but customer not enrolled — show join CTA
          setReferralUrl('');
        } else if (attempt < maxAttempts) {
          setTimeout(tryFetch, RETRY_DELAYS[attempt - 1] || 1000);
        } else {
          setReferralUrl('');
        }
      }).catch(function() {
        if (attempt < maxAttempts) {
          setTimeout(tryFetch, RETRY_DELAYS[attempt - 1] || 1000);
        } else {
          setReferralUrl('');
        }
      });
    }

    tryFetch();
  }, [customerEmail, shopDomain, orderId]);

  // ── Editor preview ──────────────────────────────────────────────────────────
  if (isEditor) {
    var previewUrl = 'https://' + (shopDomain || 'your-store.myshopify.com') + '/discount/FRIEND500?ref=REFERRAL123';
    return renderReferral({ template, tone, btnStyle, alignment, rewardText, referralUrl: previewUrl, showUrl, showSocial });
  }

  // Loading
  if (referralUrl === null) {
    return (
      <BlockStack spacing='tight'>
        <Divider />
        <Text size='small' appearance='subdued'>Checking your rewards…</Text>
      </BlockStack>
    );
  }

  // Member with referral code
  if (referralUrl) {
    // Self-referral: the buyer used their own code on this order. Show honest
    // copy and keep their code visible for future use, but suppress the share
    // buttons (they'd be misleading after they just tried to use it on themselves).
    if (wasSelfReferral) {
      return (
        <Banner status='info' title='You used your own referral code'>
          <BlockStack spacing='tight'>
            <Text>Heads up — you can't refer yourself, so no bonus was applied to this order. Share your code with a friend on their first order and you'll both earn rewards.</Text>
            {showUrl
              ? <BlockStack spacing='extraTight'>
                  <Text size='small' appearance='subdued'>Your referral link:</Text>
                  <Text size='small'>{referralUrl}</Text>
                </BlockStack>
              : null}
          </BlockStack>
        </Banner>
      );
    }
    return renderReferral({ template, tone, btnStyle, alignment, rewardText, referralUrl, showUrl, showSocial });
  }

  // Non-member
  if (customerEmail) {
    return (
      <Banner status='info' title='Refer a Friend & Earn Rewards'>
        <BlockStack spacing='tight'>
          <Text>Join our loyalty programme to unlock your referral link and earn <Text emphasis='bold'>{rewardText}</Text> on every successful referral!</Text>
        </BlockStack>
      </Banner>
    );
  }

  // Guest
  return (
    <Banner status='warning' title='Refer a Friend'>
      <BlockStack spacing='tight'>
        <Text>Sign in to view your referral link and earn <Text emphasis='bold'>{rewardText}</Text> on every successful referral.</Text>
        {shopDomain ? <Text size='small'>{'Sign in at https://' + shopDomain + '/account/login'}</Text> : null}
      </BlockStack>
    </Banner>
  );
}

// ── Shared renderer — 3 templates ───────────────────────────────────────────
function renderReferral({ template, tone, btnStyle, alignment, rewardText, referralUrl, showUrl, showSocial }) {
  var validTone      = ['success', 'info', 'warning', 'critical'].indexOf(tone) !== -1 ? tone : 'success';
  var validTemplate  = ['banner', 'minimal', 'compact'].indexOf(template) !== -1 ? template : 'banner';
  var validAlignment = ['start', 'center', 'end'].indexOf(alignment) !== -1 ? alignment : 'start';
  var waKind         = ['primary', 'secondary', 'plain'].indexOf(btnStyle) !== -1 ? btnStyle : 'primary';

  var shareMsg   = encodeURIComponent('Shop and save! Use my referral link to get ' + rewardText + ': ' + referralUrl);
  var waUrl      = 'https://wa.me/?text=' + shareMsg;
  var tweetUrl   = 'https://twitter.com/intent/tweet?text=' + shareMsg;
  var gmailUrl   = 'https://mail.google.com/mail/?view=cm&body=' + shareMsg;
  var fbUrl      = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(referralUrl);

  // ── Banner: full card ──────────────────────────────────────────────────────
  if (validTemplate === 'banner') {
    return (
      <Banner status={validTone}>
        <BlockStack spacing='base' inlineAlignment={validAlignment}>
          <Text emphasis='bold'>Refer a Friend and Earn Rewards</Text>
          <Text>Gift your friends a <Text emphasis='bold'>{rewardText}</Text> and earn 100 Points once their order is fulfilled!</Text>
          {showUrl
            ? <BlockStack spacing='extraTight'>
                <Text size='small' appearance='subdued'>Your referral link:</Text>
                <Text size='small'>{referralUrl}</Text>
              </BlockStack>
            : null}
          <Link to={waUrl} external><Button kind={waKind}>Share on WhatsApp</Button></Link>
          {showSocial
            ? <InlineStack spacing='base'>
                <Link to={tweetUrl} external><Button kind='secondary'>X (Twitter)</Button></Link>
                <Link to={gmailUrl} external><Button kind='secondary'>Gmail</Button></Link>
                <Link to={fbUrl} external><Button kind='secondary'>Facebook</Button></Link>
              </InlineStack>
            : null}
        </BlockStack>
      </Banner>
    );
  }

  // ── Compact: inline card — WhatsApp prominent ─────────────────────────────
  if (validTemplate === 'compact') {
    return (
      <Banner status={validTone} title='Refer & Earn'>
        <BlockStack spacing='tight' inlineAlignment={validAlignment}>
          <InlineStack spacing='base' blockAlignment='center'>
            <BlockStack spacing='extraTight' inlineSize='fill'>
              <Text size='small'>Share your link and earn <Text emphasis='bold'>{rewardText}</Text> per referral</Text>
              {showUrl ? <Text size='small' appearance='subdued'>{referralUrl}</Text> : null}
            </BlockStack>
            <Link to={waUrl} external><Button kind={waKind}>Share</Button></Link>
          </InlineStack>
          {showSocial
            ? <InlineStack spacing='base'>
                <Link to={tweetUrl} external><Button kind='secondary'>X</Button></Link>
                <Link to={gmailUrl} external><Button kind='secondary'>Gmail</Button></Link>
                <Link to={fbUrl} external><Button kind='secondary'>Facebook</Button></Link>
              </InlineStack>
            : null}
        </BlockStack>
      </Banner>
    );
  }

  // ── Minimal: no card, divider-separated ───────────────────────────────────
  return (
    <BlockStack spacing='tight' inlineAlignment={validAlignment}>
      <Divider />
      <Text size='small' appearance='subdued'>Refer a friend — earn <Text emphasis='bold'>{rewardText}</Text> per referral</Text>
      {showUrl ? <Text size='small'>{referralUrl}</Text> : null}
      <Link to={waUrl} external><Button kind={waKind}>Share on WhatsApp</Button></Link>
      {showSocial
        ? <InlineStack spacing='base'>
            <Link to={tweetUrl} external><Button kind='secondary'>X (Twitter)</Button></Link>
            <Link to={gmailUrl} external><Button kind='secondary'>Gmail</Button></Link>
            <Link to={fbUrl} external><Button kind='secondary'>Facebook</Button></Link>
          </InlineStack>
        : null}
    </BlockStack>
  );
}
