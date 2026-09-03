/**
 * useWidgetConfig — GoSelf Loyalty Widget V6
 *
 * Reads theme settings from the Shopify extension block context.
 * Settings are injected via Liquid into window.__GOSELF_SETTINGS__.
 *
 * What lives here (Shopify theme editor controls):
 *   Branding   — accent colour, font family
 *   Pill button — position, label, show-points, shake behaviour
 *   Messaging  — welcome message (member), guest panel headline
 *   Prizes     — leaderboard 1st/2nd/3rd prize text (only shown when leaderboard is enabled)
 *   Wallet     — voucher display style (portal setting overrides this)
 *
 * What does NOT live here (all controlled by the Goself portal / backend):
 *   Points name, tier names, feature flags (refer, leaderboard, survey,
 *   partner brands, free products, milestones), wallet voucher style.
 *   These come from get-loyalty-status and are applied in effectiveConfig
 *   inside LoyaltyWidget.jsx, overriding any Shopify value.
 */

import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// DOM settings shim — reads from Liquid-injected window global or data attr
// ---------------------------------------------------------------------------
function useSettings() {
  const [settings, setSettings] = useState(() => readSettingsFromDOM());

  useEffect(() => {
    if (window.__GOSELF_SETTINGS__) {
      setSettings(window.__GOSELF_SETTINGS__);
    }
  }, []);

  return settings;
}

function readSettingsFromDOM() {
  if (typeof window !== 'undefined' && window.__GOSELF_SETTINGS__) {
    return window.__GOSELF_SETTINGS__;
  }
  try {
    const el = document.querySelector('[data-widget-config]');
    if (el) return JSON.parse(el.getAttribute('data-widget-config') || '{}');
  } catch { /* ignore */ }
  return {};
}

// ---------------------------------------------------------------------------
// Read accent color from storefront CSS variables
// ---------------------------------------------------------------------------
function detectAccentFromCSS() {
  try {
    const style = getComputedStyle(document.documentElement);
    return (
      style.getPropertyValue('--color-accent').trim() ||
      style.getPropertyValue('--color-button').trim() ||
      null
    );
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Read body font from storefront CSS variable --font-body-family
// ---------------------------------------------------------------------------
function resolveStoreFont() {
  try {
    return (
      getComputedStyle(document.documentElement)
        .getPropertyValue('--font-body-family')
        .trim() || 'system-ui'
    );
  } catch { return 'system-ui'; }
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------
export function useWidgetConfig() {
  const settings = useSettings();
  const detectedFont = resolveStoreFont();

  return {
    // Branding
    accentColor:
      settings.accent_color_v6 || detectAccentFromCSS() || '#6366f1',
    fontFamily:
      !settings.font_family || settings.font_family === 'inherit'
        ? detectedFont
        : settings.font_family,

    // Pill button
    widgetPosition:   settings.widget_position       || 'left',
    widgetLabel:      settings.widget_label          || 'Rewards',
    showPointsOnBtn:  settings.show_points_on_button ?? true,
    shakeOnLoad:      settings.shake_on_load         ?? true,
    shakeIntervalSec: settings.shake_interval_sec    || 10,

    // Messaging
    welcomeMsg:    settings.welcome_message || 'Hi {firstName} 👋',
    guestHeadline: settings.guest_headline  || 'Earn rewards on every purchase',

    // Leaderboard prizes (text shown inside the leaderboard tab)
    prizes: [
      { rank: '🥇 1st', prize: settings.prize_1st || '₹500 voucher + 1000 pts', col: '#f59e0b' },
      { rank: '🥈 2nd', prize: settings.prize_2nd || '₹200 voucher + 500 pts',  col: '#9ca3af' },
      { rank: '🥉 3rd', prize: settings.prize_3rd || '₹100 voucher + 200 pts',  col: '#cd7c2f' },
    ],

    // Wallet voucher display style — Shopify theme editor setting; portal value overrides via effectiveConfig
    walletVoucherStyle: settings.wallet_voucher_style || 'chips',
  };
}
