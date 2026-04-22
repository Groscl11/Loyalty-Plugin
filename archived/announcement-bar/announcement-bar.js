/**
 * Announcement Bar - Theme App Extension
 * Shopify 2024-2025 Compliant
 *
 * Displays at top of site as a promotional bar
 * Installed via: Theme Customizer → Header Section → Add Block
 */

(function() {
  'use strict';

  const widgetId = window.AnnouncementBarSettings?.widget_id;
  const dismissible = window.AnnouncementBarSettings?.dismissible;

  if (!widgetId) return;

  const STORAGE_KEY = `rewards_announcement_dismissed_${widgetId}`;

  // Check if user dismissed this announcement
  if (dismissible && localStorage.getItem(STORAGE_KEY)) {
    hideBar();
    return;
  }

  const API_BASE = 'https://lizgppzyyljqbmzdytia.supabase.co';

  async function initBar() {
    try {
      const context = {
        widget_type: 'announcement_bar',
        widget_id: widgetId,
        shop: Shopify.shop,
        customer_id: window.Shopify?.customer?.id,
        page_context: {
          type: 'announcement',
          url: window.location.href
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

      if (!response.ok) {
        hideBar();
        return;
      }

      const data = await response.json();

      if (data.should_render) {
        updateBarContent(data.ui_payload, data.redeem_url);
        showBar();
      } else {
        hideBar();
      }
    } catch (error) {
      console.error('Announcement bar error:', error);
      hideBar();
    }
  }

  function updateBarContent(payload, redeemUrl) {
    const bar = document.getElementById('rewards-announcement-bar');
    if (!bar) return;

    if (payload.message) {
      const msgEl = bar.querySelector('.announcement-message');
      if (msgEl) msgEl.textContent = payload.message;
    }

    if (redeemUrl) {
      const ctaEl = bar.querySelector('.announcement-cta');
      if (ctaEl) {
        ctaEl.href = redeemUrl;
        ctaEl.style.display = 'inline-block';
      }
    }

    if (dismissible) {
      const dismissBtn = bar.querySelector('.announcement-dismiss');
      if (dismissBtn) {
        dismissBtn.style.display = 'block';
        dismissBtn.addEventListener('click', handleDismiss);
      }
    }
  }

  function handleDismiss(e) {
    e.preventDefault();
    localStorage.setItem(STORAGE_KEY, 'true');
    hideBar();
  }

  function showBar() {
    const bar = document.getElementById('rewards-announcement-bar');
    if (bar) bar.style.display = 'flex';
  }

  function hideBar() {
    const bar = document.getElementById('rewards-announcement-bar');
    if (bar) bar.style.display = 'none';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBar);
  } else {
    initBar();
  }
})();
