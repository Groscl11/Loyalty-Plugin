import { register } from '@shopify/web-pixels-extension';

// Ships with the app — activated per shop via webPixelCreate at install time
// (see supabase/functions/shopify-token-exchange), so no merchant ever edits
// theme code.
//
// Two jobs:
//  1. Click tracking — beacon to track-utm-click on every page view carrying
//     a bg_ref/ref param. Increments attribution_utm_links.clicks.
//  2. Order attribution — a completed order needs to be linked back to the
//     ref that drove it. That normally happens via note_attributes written by
//     goself-attribution.js, but that's a storefront script merchants have to
//     add manually — most never do. So instead: stash the last-seen ref in
//     the pixel's own sandboxed localStorage, and at checkout_completed, POST
//     {checkout_token, ref} to track-checkout-attribution. shopify-order-webhook
//     then joins that checkout_token back to the order it just received —
//     no theme edits, works for every install automatically.
register(({ analytics, browser, init, settings }) => {
  var DEFAULT_CLICK_ENDPOINT = 'https://jblqyvicxhmqqjhostcj.supabase.co/functions/v1/track-utm-click';
  var DEFAULT_ATTR_ENDPOINT = 'https://jblqyvicxhmqqjhostcj.supabase.co/functions/v1/track-checkout-attribution';
  var clickEndpoint = (settings && settings.clickEndpoint) || DEFAULT_CLICK_ENDPOINT;
  var attributionEndpoint = (settings && settings.attributionEndpoint) || DEFAULT_ATTR_ENDPOINT;
  var STORAGE_KEY = 'goself_attr_ref';

  function readRefParams(href) {
    try {
      var params = new URL(href).searchParams;
      var ref = params.get('bg_ref') || params.get('bg_aff') || params.get('ref') || params.get('aff') || null;
      if (!ref) return null;
      return {
        ref: ref,
        source: params.get('utm_source') || null,
        medium: params.get('utm_medium') || null,
        campaign: params.get('utm_campaign') || null,
      };
    } catch (e) {
      return null;
    }
  }

  analytics.subscribe('page_viewed', function (event) {
    var href = event && event.context && event.context.document && event.context.document.location
      ? event.context.document.location.href
      : null;
    if (!href) return;

    var parsed = readRefParams(href);
    if (!parsed) return;

    fetch(clickEndpoint + '?ref=' + encodeURIComponent(parsed.ref), { keepalive: true }).catch(function () {});

    try {
      browser.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch (e) {
      // sandbox storage unavailable — order-level attribution just won't fire, clicks still count
    }
  });

  analytics.subscribe('checkout_completed', function (event) {
    var token = event && event.data && event.data.checkout ? event.data.checkout.token : null;
    var shop = init && init.data && init.data.shop ? init.data.shop.myshopifyDomain : null;
    if (!token || !shop) return;

    browser.localStorage.getItem(STORAGE_KEY).then(function (stored) {
      if (!stored) return;
      var parsed;
      try { parsed = JSON.parse(stored); } catch (e) { return; }
      if (!parsed || !parsed.ref) return;

      fetch(attributionEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          shop: shop,
          checkout_token: token,
          ref: parsed.ref,
          source: parsed.source,
          medium: parsed.medium,
          campaign: parsed.campaign,
        }),
      }).catch(function () {});
    }).catch(function () {});
  });
});
