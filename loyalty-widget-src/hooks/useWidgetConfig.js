/**
 * useWidgetConfig — GoSelf Loyalty Widget V6
 *
 * Reads all theme settings from the Shopify extension block context.
 * In a theme extension, settings are injected via Liquid into
 * window.__GOSELF_SETTINGS__ (set in the Liquid template).
 * Fallback: read from the widget container's data-widget-config attribute.
 *
 * NOTE: If this ever runs inside a Shopify UI Extension (storefront target),
 * swap the useSettings import to:
 *   import { useSettings } from "@shopify/ui-extensions-react/storefront"
 * and remove the DOM-reading fallback below.
 */

import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// DOM settings shim — reads from Liquid-injected window global or data attr
// ---------------------------------------------------------------------------
function useSettings() {
  const [settings, setSettings] = useState(() => readSettingsFromDOM());

  useEffect(() => {
    // Re-read if window.__GOSELF_SETTINGS__ is populated after mount
    if (window.__GOSELF_SETTINGS__) {
      setSettings(window.__GOSELF_SETTINGS__);
    }
  }, []);

  return settings;
}

function readSettingsFromDOM() {
  // 1. Prefer window global (set by Liquid: window.__GOSELF_SETTINGS__ = {{ block.settings | json }})
  if (typeof window !== 'undefined' && window.__GOSELF_SETTINGS__) {
    return window.__GOSELF_SETTINGS__;
  }
  // 2. Fallback: parse from container data attribute
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
    heroBannerBg:  settings.hero_banner_bg   || '#111111',
    heroBannerTc:  settings.hero_text_color  || '#ffffff',
    fontFamily:
      !settings.font_family || settings.font_family === 'inherit'
        ? detectedFont
        : settings.font_family,

    // Pill button
    widgetPosition:   settings.widget_position      || 'left',
    widgetLabel:      settings.widget_label         || 'Rewards',
    showPointsOnBtn:  settings.show_points_on_button ?? true,
    shakeOnLoad:      settings.shake_on_load        ?? true,
    shakeIntervalSec: settings.shake_interval_sec   || 10,

    // Messaging
    pointsNoun:   settings.points_noun  || 'Points',
    pointsAbbrev: settings.points_abbrev || 'pts',
    rewardNoun:   settings.reward_noun  || 'Reward',
    tierNames: {
      bronze:   settings.tier_bronze_name   || 'Bronze',
      silver:   settings.tier_silver_name   || 'Silver',
      gold:     settings.tier_gold_name     || 'Gold',
      platinum: settings.tier_platinum_name || 'Platinum',
    },
    welcomeMsg:   settings.welcome_message || 'Hi {firstName} 👋',
    guestHeadline: settings.guest_headline || 'Earn rewards on every purchase',
    guestSubline:  settings.guest_subline  || 'Points · Partner offers · Milestone gifts',

    // Feature flags
    showReferTab:       settings.show_refer_tab       ?? true,
    showLeaderboard:    settings.show_leaderboard     ?? true,
    showSurvey:         settings.show_survey          ?? true,
    showPartnerBrands:  settings.show_partner_brands  ?? true,
    enableFreeProducts: settings.enable_free_products ?? true,
    showMilestones:     settings.show_milestones      ?? true,

    // Leaderboard prizes
    prizes: [
      { rank: '🥇 1st', prize: settings.prize_1st || '₹500 voucher + 1000 pts', col: '#f59e0b' },
      { rank: '🥈 2nd', prize: settings.prize_2nd || '₹200 voucher + 500 pts',  col: '#9ca3af' },
      { rank: '🥉 3rd', prize: settings.prize_3rd || '₹100 voucher + 200 pts',  col: '#cd7c2f' },
    ],

    // Legacy passthrough (used by existing Liquid template)
    primaryColor: settings.primary_color || '#3B82F6',
  };
}
