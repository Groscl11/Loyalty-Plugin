/**
 * GoSelf Loyalty Widget V6 — Bundle Entry Point
 *
 * Reads config injected by Liquid (window.__GOSELF_SETTINGS__),
 * mounts the React app into #goself-loyalty-root.
 *
 * The Liquid block sets:
 *   window.__GOSELF_SETTINGS__ = {{ block.settings | json }};
 */

// ── Referral Code Capture ─────────────────────────────────────────────────────
// Runs immediately on every page load.
// 1. If ?ref=CODE is in the URL, persist it to localStorage.
// 2. If a stored ref exists, inject it into the Shopify cart as a note_attribute
//    so that shopify-order-webhook can attribute the order to the referrer.
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var refCode = params.get('ref');
    if (refCode && /^[A-Z0-9]{4,16}$/i.test(refCode)) {
      localStorage.setItem('goself_ref_code', refCode.toUpperCase());
    }
    var storedRef = localStorage.getItem('goself_ref_code');
    if (storedRef && typeof fetch !== 'undefined') {
      // Idempotent — safe to call on every page; Shopify merges attributes
      fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes: { goself_ref: storedRef } }),
      }).catch(function () {});
    }
  } catch (e) {}
})();
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { createRoot } from 'react-dom/client';
import { LoyaltyWidget } from './LoyaltyWidget.jsx';

function mount() {
  const container = document.getElementById('goself-loyalty-root');
  if (!container) return;

  // Guard against double-mounting (e.g. theme editor reloads)
  if (container.__goselfMounted) return;
  container.__goselfMounted = true;

  const root = createRoot(container);
  root.render(React.createElement(LoyaltyWidget));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
