import React, { useState, useEffect } from 'react';
import {
  reactExtension,
  BlockStack, InlineStack,
  Text, Divider, Banner,
  useShop, useSettings, useEmail, usePhone,
  useTotalAmount, useCustomer, useExtensionEditor,
} from '@shopify/ui-extensions-react/checkout';

const _env = (function() { try { return process.env || {}; } catch(e) { return {}; } })();
const SUPABASE_URL      = _env.SUPABASE_URL      || 'https://jblqyvicxhmqqjhostcj.supabase.co';
const SUPABASE_ANON_KEY = _env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibHF5dmljeGhtcXFqaG9zdGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTU1MTAsImV4cCI6MjA5Mjc3MTUxMH0.pMOn3TKgzp_QqJgOlMzwO7ZRRex-mifWUzhJPwxUndE';

export default reactExtension('purchase.checkout.block.render', () => <CheckoutPointsReminder />);

function CheckoutPointsReminder() {
  let shop, settings, hookEmail, hookPhone, totalAmount, customer, editor;
  try { shop        = useShop();             } catch(e) { shop        = null; }
  try { settings    = useSettings();         } catch(e) { settings    = null; }
  try { hookEmail   = useEmail();            } catch(e) { hookEmail   = ''; }
  try { hookPhone   = usePhone();            } catch(e) { hookPhone   = ''; }
  try { totalAmount = useTotalAmount();      } catch(e) { totalAmount = null; }
  try { customer    = useCustomer();         } catch(e) { customer    = null; }
  try { editor      = useExtensionEditor();  } catch(e) { editor      = null; }

  const isEditor      = !!editor;
  const shopDomain    = shop ? shop.myshopifyDomain : '';
  const customerEmail = hookEmail || '';
  const customerPhone = hookPhone || '';
  const orderTotal    = totalAmount ? parseFloat(totalAmount.amount) || 0 : 0;

  // Settings with defaults
  const headingText   = settings && settings.checkout_heading_text   ? settings.checkout_heading_text   : 'Your rewards on this order';
  const template      = settings && settings.template                 ? String(settings.template).toLowerCase().trim() : 'banner';
  const tone          = settings && settings.banner_tone              ? String(settings.banner_tone).toLowerCase().trim() : 'info';
  const showBalance   = settings ? settings.show_balance !== false : true;
  const alignment     = settings && settings.text_alignment           ? String(settings.text_alignment).toLowerCase().trim() : 'start';
  const signinBtnStyle= settings && settings.signin_button_style      ? String(settings.signin_button_style).toLowerCase().trim() : 'secondary';
  const signinBtnText = settings && settings.signin_button_text       ? String(settings.signin_button_text).trim() : 'Sign in to earn rewards';

  const [memberData, setMemberData] = useState(null);

  useEffect(function() {
    if (isEditor || !shopDomain) { setMemberData(false); return; }

    // Guests: no email/phone yet at checkout start — show sign-in nudge
    if (!customerEmail && !customerPhone) { setMemberData(false); return; }

    var baseUrl = SUPABASE_URL + '/functions/v1/get-loyalty-status?shop_domain=' + encodeURIComponent(shopDomain);
    if (customerEmail) {
      baseUrl += '&email=' + encodeURIComponent(customerEmail);
    } else if (customerPhone) {
      baseUrl += '&phone=' + encodeURIComponent(customerPhone);
    }

    fetch(baseUrl, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && !data.error && data.points_balance != null) {
        setMemberData(data);
      } else {
        setMemberData(false);
      }
    })
    .catch(function() { setMemberData(false); });
  }, [customerEmail, customerPhone, shopDomain]);

  // ── Editor preview ───────────────────────────────────────────────────────────
  if (isEditor) {
    return renderCheckoutPoints({ template, tone, alignment, headingText, showBalance, earned: 120, balance: 500, name: 'Points' });
  }

  // Loading — don't render anything to avoid layout shift during checkout
  if (memberData === null) return null;

  // ── Member found ─────────────────────────────────────────────────────────────
  if (memberData && memberData.points_balance != null) {
    var rate    = memberData.tier && memberData.tier.points_earn_rate    != null ? memberData.tier.points_earn_rate    : 1;
    var divisor = memberData.tier && memberData.tier.points_earn_divisor != null ? memberData.tier.points_earn_divisor : 1;
    var name    = memberData.program && memberData.program.points_name   ? memberData.program.points_name : 'Points';
    var earned  = divisor > 0 ? Math.floor((orderTotal / divisor) * rate) : 0;
    var balance = memberData.points_balance || 0;

    // Only render if the order earns something
    if (earned <= 0) return null;

    return renderCheckoutPoints({ template, tone, alignment, headingText, showBalance, earned, balance, name });
  }

  // ── Non-member or guest — sign-in nudge ────────────────────────────────────
  if (!customer && shopDomain) {
    var validTone  = ['success', 'info', 'warning', 'critical'].indexOf(tone) !== -1 ? tone : 'info';
    var btnKind    = ['primary', 'secondary', 'plain'].indexOf(signinBtnStyle) !== -1 ? signinBtnStyle : 'secondary';
    return (
      <Banner status={validTone}>
        <BlockStack spacing='tight' inlineAlignment={alignment}>
          <Text emphasis='bold'>Earn rewards on this order</Text>
          <Text size='small' appearance='subdued'>Sign in to earn loyalty points every time you shop.</Text>
        </BlockStack>
      </Banner>
    );
  }

  return null;
}

function renderCheckoutPoints({ template, tone, alignment, headingText, showBalance, earned, balance, name }) {
  var validTone      = ['success', 'info', 'warning', 'critical'].indexOf(tone) !== -1 ? tone : 'info';
  var validTemplate  = ['banner', 'minimal', 'compact'].indexOf(template) !== -1 ? template : 'banner';
  var validAlignment = ['start', 'center', 'end'].indexOf(alignment) !== -1 ? alignment : 'start';

  if (validTemplate === 'banner') {
    return (
      <Banner status={validTone}>
        <BlockStack spacing='tight' inlineAlignment={validAlignment}>
          <Text emphasis='bold'>{headingText}</Text>
          <Text size='large' emphasis='bold'>+{earned} {name} on this order ⭐</Text>
          {showBalance
            ? <Text size='small' appearance='subdued'>Current balance: {balance.toLocaleString()} {name}</Text>
            : null}
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
          <Text size='large' emphasis='bold'>+{earned} {name} ⭐</Text>
        </InlineStack>
        {showBalance
          ? <Text size='small' appearance='subdued'>Balance: {balance.toLocaleString()} {name}</Text>
          : null}
      </BlockStack>
    );
  }

  // minimal
  return (
    <BlockStack spacing='tight' inlineAlignment={validAlignment}>
      <Divider />
      <Text size='small' appearance='subdued'>{headingText}</Text>
      <Text size='large' emphasis='bold'>+{earned} {name} ⭐</Text>
      {showBalance
        ? <Text size='small' appearance='subdued'>Balance: {balance.toLocaleString()} {name}</Text>
        : null}
    </BlockStack>
  );
}
