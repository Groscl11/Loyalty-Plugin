/**
 * Loyalty by Goself — App Embed
 * Loads the loyalty widget on the Shopify storefront
 * Dashboard: https://goself.netlify.app
 */

(function() {
  'use strict';

  // Get shop domain from Shopify
  const shopDomain = window.Shopify?.shop || null;

  if (!shopDomain) {
    console.warn('Loyalty by Goself: Shop domain not found');
    return;
  }

  // Widget configuration from theme settings
  const widgetEnabled = {{ app_embed.settings.enabled | json }};
  const widgetPosition = {{ app_embed.settings.position | json }} || 'bottom-right';

  if (!widgetEnabled) {
    console.log('Loyalty by Goself: Widget disabled');
    return;
  }

  // Load widget script
  const scriptSrc = `https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/widget-script?shop=${shopDomain}&position=${widgetPosition}`;

  const script = document.createElement('script');
  script.src = scriptSrc;
  script.async = true;
  script.setAttribute('data-loyalty-widget', 'true');

  script.onerror = function() {
    console.error('Loyalty by Goself: Failed to load widget');
  };

  script.onload = function() {
    console.log('Loyalty by Goself: Widget loaded');
  };

  document.head.appendChild(script);
})();

// Handle referral code from URL (?ref=CODE)
(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const referralCode = urlParams.get('ref');
  if (!referralCode) return;

  sessionStorage.setItem('goself_referral_code', referralCode);

  const shopDomain = window.Shopify?.shop;
  const customerEmail = window.Shopify?.customerEmail;
  if (!shopDomain) return;

  fetch('https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/apply-referral-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      referral_code: referralCode,
      shop_domain: shopDomain,
      referred_email: customerEmail || null,
    })
  }).catch(() => {});
})();
