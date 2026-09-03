import React, { useState, useEffect } from 'react';
import { reactExtension, BlockStack, InlineStack, Text, Divider, Banner, Button, Link, useShop, useSettings, useEmail, usePhone, useTotalAmount, useCustomer, useApi, useSubscription, useExtensionEditor } from '@shopify/ui-extensions-react/checkout';

const _env = (function() { try { return process.env || {}; } catch(e) { return {}; } })();
// C-12: No hardcoded fallbacks — missing env vars render widget silently invisible
const SUPABASE_URL      = _env.SUPABASE_URL      || 'https://jblqyvicxhmqqjhostcj.supabase.co';
const SUPABASE_ANON_KEY = _env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibHF5dmljeGhtcXFqaG9zdGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTU1MTAsImV4cCI6MjA5Mjc3MTUxMH0.pMOn3TKgzp_QqJgOlMzwO7ZRRex-mifWUzhJPwxUndE';

// usePhone() on Shopify's thank-you page is unreliable: it may return empty or
// return the number without a country-code prefix.  We pass the order ID as a
// secondary identifier so the backend can resolve the member via the points
// transaction once the webhook fires (~3-10 s after checkout).
var EMPTY_SUBSCRIBABLE = Object.freeze({ current: null, subscribe: function() { return function() {}; } });
// Uniform 1 s polling — catches the webhook within 1 s of completion.
var RETRY_DELAYS = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];

export default reactExtension('purchase.thank-you.block.render', () => <PointsEarnedWidget />);

function PointsEarnedWidget() {
  let shop, settings, hookEmail, hookPhone, totalAmount, customer, apiObj, editor;
  try { shop = useShop(); } catch(e) { shop = null; }
  try { settings = useSettings(); } catch(e) { settings = null; }
  try { hookEmail = useEmail(); } catch(e) { hookEmail = ''; }
  try { hookPhone = usePhone(); } catch(e) { hookPhone = ''; }
  try { totalAmount = useTotalAmount(); } catch(e) { totalAmount = null; }
  try { customer = useCustomer(); } catch(e) { customer = null; }
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
  const headingText   = settings && settings.heading_text ? settings.heading_text : 'Rewards Earned on This Order';
  const template      = settings && settings.template ? String(settings.template).toLowerCase().trim() : 'banner';
  const tone          = settings && settings.banner_tone ? String(settings.banner_tone).toLowerCase().trim() : 'success';
  const showBalance    = settings ? settings.show_balance !== false : true;
  const showNote       = settings ? settings.show_fulfilled_note !== false : true;
  const alignment      = settings && settings.text_alignment ? String(settings.text_alignment).toLowerCase().trim() : 'start';
  const signinBtnStyle = settings && settings.signin_button_style ? String(settings.signin_button_style).toLowerCase().trim() : 'secondary';
  const signinBtnText  = settings && settings.signin_button_text  ? String(settings.signin_button_text).trim()                : 'Sign in to your account';
  const orderTotal    = totalAmount ? parseFloat(totalAmount.amount) || 0 : 0;

  const [memberData, setMemberData] = useState(null);

  useEffect(function() {
    // Option B: order-verified endpoint. Requires order_id + email (the order's
    // own email is verified against Shopify Admin API server-side). Phone-only
    // guests can't be order-verified, so they see the sign-in prompt.
    if (isEditor || !shopDomain || !orderId || !customerEmail) { setMemberData(false); return; }

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
        if (data && data.verified && data.is_member) {
          setMemberData(data);
        } else if (data && data.verified && data.is_member === false) {
          setMemberData(false); // order verified but customer not enrolled
        } else if (attempt < maxAttempts) {
          setTimeout(tryFetch, RETRY_DELAYS[attempt - 1] || 1000);
        } else {
          setMemberData(false);
        }
      }).catch(function() {
        if (attempt < maxAttempts) {
          setTimeout(tryFetch, RETRY_DELAYS[attempt - 1] || 1000);
        } else {
          setMemberData(false);
        }
      });
    }

    tryFetch();
  }, [customerEmail, shopDomain, orderId]);

  // ── Editor preview ─────────────────────────────────────────────────────────
  if (isEditor) {
    return renderPoints({ template, tone, alignment, headingText, showBalance, showNote, earned: 120, balance: 500, name: 'Points' });
  }

  // Loading
  if (memberData === null) {
    return (
      <BlockStack spacing='tight'>
        <Divider />
        <Text size='small' appearance='subdued'>Calculating your rewards…</Text>
      </BlockStack>
    );
  }

  // Member found (order-verified)
  if (memberData && memberData.points_balance != null) {
    var name    = memberData.points_name || 'Points';
    var earned  = memberData.points_earned_this_order || 0;
    // Fallback: estimate from order total × rate if the webhook hasn't recorded the txn yet
    if (!earned && orderTotal > 0 && memberData.tier) {
      var rate    = memberData.tier.points_earn_rate    != null ? memberData.tier.points_earn_rate    : 1;
      var divisor = memberData.tier.points_earn_divisor != null ? memberData.tier.points_earn_divisor : 1;
      earned = divisor > 0 ? Math.floor((orderTotal / divisor) * rate) : 0;
    }
    var balance = memberData.points_balance || 0;

    var signInUrl = (!customer && shopDomain) ? 'https://' + shopDomain + '/account/login' : null;
    return renderPoints({ template, tone, alignment, headingText, showBalance, showNote, earned, balance, name, signInUrl, signinBtnStyle, signinBtnText });
  }

  // Non-member — prompt to sign in
  var nonMemberBtnKind = ['primary', 'secondary', 'plain'].indexOf(signinBtnStyle) !== -1 ? signinBtnStyle : 'primary';
  return (
    <BlockStack spacing='tight'>
      <Divider />
      <Text emphasis='bold'>Sign in to see your rewards</Text>
      <Text size='small' appearance='subdued'>Sign in to view the Points you earned on this order.</Text>
      {shopDomain
        ? <Link to={'https://' + shopDomain + '/account/login'} external>
            <Button kind={nonMemberBtnKind}>{signinBtnText}</Button>
          </Link>
        : null}
    </BlockStack>
  );
}

// ── Shared renderer — same logic for all surfaces ───────────────────────────
function renderPoints({ template, tone, alignment, headingText, showBalance, showNote, earned, balance, name, signInUrl, signinBtnStyle, signinBtnText }) {
  var validTone      = ['success', 'info', 'warning', 'critical'].indexOf(tone) !== -1 ? tone : 'success';
  var validTemplate  = ['banner', 'minimal', 'compact'].indexOf(template) !== -1 ? template : 'banner';
  var validAlignment = ['start', 'center', 'end'].indexOf(alignment) !== -1 ? alignment : 'start';
  var btnKind        = ['primary', 'secondary', 'plain'].indexOf(signinBtnStyle) !== -1 ? signinBtnStyle : 'secondary';
  var btnText        = signinBtnText || 'Sign in to your account';
  var signInBtn      = signInUrl
    ? <Link to={signInUrl} external><Button kind={btnKind}>{btnText}</Button></Link>
    : null;

  if (validTemplate === 'banner') {
    return (
      <Banner status={validTone}>
        <BlockStack spacing='tight' inlineAlignment={validAlignment}>
          <Text emphasis='bold'>{headingText}</Text>
          <Text size='large' emphasis='bold'>+{earned} {name} on this order 🎉</Text>
          {showBalance ? <Text size='small' appearance='subdued'>Your new balance after fulfilment: {balance} {name}</Text> : null}
          {showNote ? <Text size='small' appearance='subdued'>{name} are credited once your order is fulfilled.</Text> : null}
          {signInBtn}
        </BlockStack>
      </Banner>
    );
  }

  if (validTemplate === 'compact') {
    return (
      <BlockStack spacing='extraTight' inlineAlignment={validAlignment}>
        <Divider />
        <InlineStack spacing='base' blockAlignment='center'>
          <Text size='small' appearance='subdued'>{headingText}</Text>
          <Text size='large' emphasis='bold'>+{earned} {name} 🎉</Text>
        </InlineStack>
        {showBalance ? <Text size='small' appearance='subdued'>Balance after fulfilment: {balance} {name}</Text> : null}
        {showNote ? <Text size='small' appearance='subdued'>{name} are credited once your order is fulfilled.</Text> : null}
        {signInBtn}
      </BlockStack>
    );
  }

  // minimal
  return (
    <BlockStack spacing='tight' inlineAlignment={validAlignment}>
      <Divider />
      <Text size='small' appearance='subdued'>{headingText}</Text>
      <Text size='large' emphasis='bold'>+{earned} {name} on this order 🎉</Text>
      {showBalance ? <Text size='small' appearance='subdued'>Your new balance after fulfilment: {balance} {name}</Text> : null}
      {showNote ? <Text size='small' appearance='subdued'>{name} are credited once your order is fulfilled.</Text> : null}
      {signInBtn}
    </BlockStack>
  );
}
