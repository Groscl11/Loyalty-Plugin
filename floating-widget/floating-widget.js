/**
 * Floating Widget - Theme App Extension
 * Shopify 2024-2025 Compliant
 *
 * This widget renders as a floating button in the bottom-right corner.
 * Installed via: Theme Customizer → App Embeds
 * No manual script injection required.
 */

(function() {
  'use strict';

  // Get widget configuration from Shopify settings
  const widgetId = window.FloatingWidgetSettings?.widget_id;
  const enabled = window.FloatingWidgetSettings?.enabled;

  if (!enabled || !widgetId) {
    return;
  }

  const API_BASE = 'https://lizgppzyyljqbmzdytia.supabase.co';

  async function initWidget() {
    try {
      // Gather context
      const context = {
        widget_type: 'floating',
        widget_id: widgetId,
        shop: Shopify.shop,
        customer_id: window.Shopify?.customerPrivacy?.userCanBeTracked() ? window.Shopify.customer?.id : null,
        page_context: {
          type: getPageType(),
          url: window.location.href
        }
      };

      // Call unified API endpoint
      const response = await fetch(`https://lizgppzyyljqbmzdytia.supabase.co/functions/v1/loyalty-widget-panel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
        shop_domain: window.Shopify?.shop || window.location.hostname,
        customer_email: window.Shopify?.customerEmail || null,
      })
      });

      if (!response.ok) return;

      const data = await response.json();

      if (data.should_render) {
        renderFloatingWidget(data.ui_payload, data.redeem_url);
      }
    } catch (error) {
      console.error('Floating widget error:', error);
    }
  }

  function getPageType() {
    if (window.location.pathname === '/') return 'home';
    if (window.location.pathname.includes('/products/')) return 'product';
    if (window.location.pathname.includes('/collections/')) return 'collection';
    if (window.location.pathname.includes('/cart')) return 'cart';
    return 'other';
  }

  function renderFloatingWidget(payload, redeemUrl) {
    const container = document.createElement('div');
    container.id = 'rewards-floating-widget';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      max-width: 320px;
      cursor: pointer;
      animation: slideIn 0.3s ease-out;
    `;

    container.innerHTML = `
      <div style="
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 20px 24px;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        transition: transform 0.2s;
      " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
        <div style="font-size: 24px; margin-bottom: 8px;">🎁 ${escapeHtml(payload.title || 'Special Reward')}</div>
        <div style="font-size: 14px; opacity: 0.95; line-height: 1.4;">
          ${escapeHtml(payload.description || 'Click to claim your exclusive reward!')}
        </div>
      </div>
    `;

    if (redeemUrl) {
      container.addEventListener('click', () => {
        window.location.href = redeemUrl;
      });
    }

    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateY(100px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(container);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }
})();
