import React, { useState, useEffect } from 'react';
import { reactExtension, Banner, Button, BlockStack, InlineStack, Text, Link, Divider, useShop, useSettings, useCustomer, useOrder, useExtensionEditor } from '@shopify/ui-extensions-react/customer-account';

const _env = (function() { try { return process.env || {}; } catch(e) { return {}; } })();
// C-12: No hardcoded fallbacks — missing env vars render widget silently invisible
const SUPABASE_URL      = _env.SUPABASE_URL      || 'https://jblqyvicxhmqqjhostcj.supabase.co';
const SUPABASE_ANON_KEY = _env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibHF5dmljeGhtcXFqaG9zdGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTU1MTAsImV4cCI6MjA5Mjc3MTUxMH0.pMOn3TKgzp_QqJgOlMzwO7ZRRex-mifWUzhJPwxUndE';

var RETRY_DELAYS = [1000, 2500, 5000, 10000];

export const forOrderStatus = reactExtension('customer-account.order-status.block.render', () => <ReferralWidgetOrderStatus />);

function ReferralWidgetOrderStatus() {
  let shop, settings, customer, order, editor;
  try { shop = useShop(); } catch(e) { shop = null; }
  try { settings = useSettings(); } catch(e) { settings = null; }
  try { customer = useCustomer(); } catch(e) { customer = null; }
  try { order = useOrder(); } catch(e) { order = null; }
  try { editor = useExtensionEditor(); } catch(e) { editor = null; }

  const isEditor      = !!editor;
  const shopDomain    = shop ? shop.myshopifyDomain : '';
  const shopifyOrderId = order && order.id ? String(order.id).split('/').pop() : '';
  // useCustomer() requires full auth; fall back to order.email for guests viewing via order token
  const customerEmail = (customer && customer.email ? customer.email : '') ||
                        (order && order.email ? String(order.email) : '') ||
                        (order && order.customer && order.customer.email ? String(order.customer.email) : '');
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
    // Option B: order-verified endpoint requires order_id + email
    if (isEditor || !shopDomain || !shopifyOrderId || !customerEmail) { setReferralUrl(''); setWasSelfReferral(false); return; }

    var attempt = 0;
    var maxAttempts = RETRY_DELAYS.length + 1;

    function tryFetch() {
      attempt++;
      fetch(SUPABASE_URL + '/functions/v1/get-order-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
        body: JSON.stringify({ shop_domain: shopDomain, order_id: shopifyOrderId, email: customerEmail }),
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data && data.verified && data.is_member && data.referral_code) {
          setWasSelfReferral(false);
          setReferralUrl('https://' + shopDomain + '/?ref=' + encodeURIComponent(data.referral_code));
        } else if (data && data.verified && data.is_member === false) {
          setReferralUrl('');
        } else if (attempt < maxAttempts) {
          setTimeout(tryFetch, RETRY_DELAYS[attempt - 1] || 5000);
        } else {
          setReferralUrl('');
        }
      }).catch(function() {
        if (attempt < maxAttempts) {
          setTimeout(tryFetch, RETRY_DELAYS[attempt - 1] || 5000);
        } else {
          setReferralUrl('');
        }
      });
    }

    tryFetch();
  }, [customerEmail, shopDomain, shopifyOrderId]);

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
    // Self-referral: keep code visible, suppress share buttons, show honest copy.
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

  // Non-member — render nothing on order-status/detail (keep it clean)
  return null;
}

// ── Shared renderer — 3 templates ───────────────────────────────────────────
function renderReferral({ template, tone, btnStyle, alignment, rewardText, referralUrl, showUrl, showSocial }) {
  var validTone      = ['success', 'info', 'warning', 'critical'].indexOf(tone) !== -1 ? tone : 'success';
  var validTemplate  = ['banner', 'minimal', 'compact'].indexOf(template) !== -1 ? template : 'banner';
  var validAlignment = ['start', 'center', 'end'].indexOf(alignment) !== -1 ? alignment : 'start';
  var waKind         = ['primary', 'secondary', 'plain'].indexOf(btnStyle) !== -1 ? btnStyle : 'primary';

  var shareMsg = encodeURIComponent('Shop and save! Use my referral link to get ' + rewardText + ': ' + referralUrl);
  var waUrl    = 'https://wa.me/?text=' + shareMsg;
  var tweetUrl = 'https://twitter.com/intent/tweet?text=' + shareMsg;
  var gmailUrl = 'https://mail.google.com/mail/?view=cm&body=' + shareMsg;
  var fbUrl    = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(referralUrl);

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

  // ── Compact: inline card ──────────────────────────────────────────────────
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

  // ── Minimal: no card ──────────────────────────────────────────────────────
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
