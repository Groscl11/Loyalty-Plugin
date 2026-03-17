/**
 * GoSelf Loyalty Widget V6 — Bundle Entry Point
 *
 * Reads config injected by Liquid (window.__GOSELF_SETTINGS__),
 * mounts the React app into #goself-loyalty-root.
 *
 * The Liquid block sets:
 *   window.__GOSELF_SETTINGS__ = {{ block.settings | json }};
 */

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
