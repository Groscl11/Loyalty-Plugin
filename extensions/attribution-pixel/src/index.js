import { register } from '@shopify/web-pixels-extension';

// Ships with the app — activated per shop via webPixelCreate at install time,
// so no merchant edits theme code. See supabase/functions/shopify-oauth-callback.
register(({ analytics, settings }) => {
  var DEFAULT_ENDPOINT = 'https://jblqyvicxhmqqjhostcj.supabase.co/functions/v1/track-utm-click';
  var clickEndpoint = (settings && settings.clickEndpoint) || DEFAULT_ENDPOINT;

  function readRef(href) {
    try {
      var params = new URL(href).searchParams;
      return (
        params.get('bg_ref') ||
        params.get('bg_aff') ||
        params.get('ref') ||
        params.get('aff') ||
        null
      );
    } catch (e) {
      return null;
    }
  }

  analytics.subscribe('page_viewed', function (event) {
    var href = event && event.context && event.context.document && event.context.document.location
      ? event.context.document.location.href
      : null;
    if (!href) return;

    var ref = readRef(href);
    if (!ref) return;

    fetch(clickEndpoint + '?ref=' + encodeURIComponent(ref), { keepalive: true }).catch(function () {});
  });
});
