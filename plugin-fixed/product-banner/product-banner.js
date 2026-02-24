/**
 * Product Banner - Theme App Extension
 * Shopify 2024-2025 Compliant
 *
 * Appears on product pages as a promotional banner
 * Installed via: Theme Customizer → Product Page → Add Block
 */

(function() {
  'use strict';

  const widgetId = window.ProductBannerSettings?.widget_id;

  if (!widgetId) return;

  const API_BASE = 'https://lizgppzyyljqbmzdytia.supabase.co';

  async function initBanner() {
    try {
      const productId = getProductId();

      const context = {
        widget_type: 'product_banner',
        widget_id: widgetId,
        shop: Shopify.shop,
        customer_id: window.Shopify?.customer?.id,
        page_context: {
          type: 'product',
          product_id: productId
        }
      };

      const response = await fetch(`https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/loyalty-widget-panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        shop_domain: window.Shopify?.shop || window.location.hostname,
        customer_email: window.Shopify?.customerEmail || null,
      })
      });

      if (!response.ok) return;

      const data = await response.json();

      if (data.should_render) {
        updateBannerContent(data.ui_payload);
      }
    } catch (error) {
      console.error('Product banner error:', error);
    }
  }

  function getProductId() {
    const metaProduct = document.querySelector('meta[property="product:id"]');
    return metaProduct ? metaProduct.content : null;
  }

  function updateBannerContent(payload) {
    const banner = document.getElementById('rewards-product-banner');
    if (!banner) return;

    if (payload.title) {
      const titleEl = banner.querySelector('.banner-title');
      if (titleEl) titleEl.textContent = payload.title;
    }

    if (payload.description) {
      const descEl = banner.querySelector('.banner-description');
      if (descEl) descEl.textContent = payload.description;
    }

    if (payload.redeem_url) {
      const ctaBtn = banner.querySelector('.banner-cta');
      if (ctaBtn) {
        ctaBtn.href = payload.redeem_url;
        ctaBtn.style.display = 'inline-block';
      }
    }

    banner.style.display = 'flex';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBanner);
  } else {
    initBanner();
  }
})();
