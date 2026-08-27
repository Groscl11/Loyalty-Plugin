/**
 * Goself Attribution Script
 *
 * Install: Add as a Shopify Script Tag via the Loyalty by Goself app,
 * or paste into your theme as a <script> block in theme.liquid (before </body>).
 *
 * What it does:
 *   1. On every page load, reads UTM + attribution params from the URL
 *   2. Stores first-touch (never overwritten) and last-touch (always updated) in localStorage
 *   3. Writes both to Shopify cart attributes so they appear on the order as note_attributes
 *   4. Respects the attribution window — data expires after N days (default 30)
 *
 * Order note_attributes written:
 *   _aff_ft_ref    — first-touch attribution param value (e.g. "graboi_diwali26")
 *   _aff_ft_src    — first-touch utm_source
 *   _aff_ft_med    — first-touch utm_medium
 *   _aff_ft_cam    — first-touch utm_campaign
 *   _aff_ft_ts     — first-touch ISO timestamp
 *   _aff_lt_ref    — last-touch attribution param value
 *   _aff_lt_src    — last-touch utm_source
 *   _aff_lt_med    — last-touch utm_medium
 *   _aff_lt_cam    — last-touch utm_campaign
 *   _aff_lt_ts     — last-touch ISO timestamp
 *   _aff_touches   — total touch count in window
 */

(function () {
  'use strict';

  var STORAGE_KEY = '_gsa_v1';
  var WINDOW_DAYS = 30;

  // ── Read incoming UTM/attribution params ────────────────────────────────────
  function readParams() {
    var p = new URLSearchParams(window.location.search);

    // Support all four prefix variants the client may have configured
    var ref =
      p.get('bg_ref') ||
      p.get('bg_aff') ||
      p.get('ref') ||
      p.get('aff') ||
      null;

    var source   = p.get('utm_source')   || null;
    var medium   = p.get('utm_medium')   || null;
    var campaign = p.get('utm_campaign') || null;

    // Only treat this as a tracked visit if there's an attribution param or utm_source
    if (!ref && !source) return null;

    return {
      ref:      ref,
      source:   source,
      medium:   medium,
      campaign: campaign,
      ts:       new Date().toISOString(),
    };
  }

  // ── localStorage helpers ─────────────────────────────────────────────────────
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      var windowDays = data.window_days || WINDOW_DAYS;
      var firstTs    = new Date(data.first_touch ? data.first_touch.ts : data.ts);
      var expiresAt  = new Date(firstTs.getTime() + windowDays * 86400000);
      if (new Date() > expiresAt) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function save(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  // ── Write to Shopify cart attributes ─────────────────────────────────────────
  function writeCartAttributes(data) {
    var ft = data.first_touch || {};
    var lt = data.last_touch  || {};
    var attrs = {
      '_aff_ft_ref': ft.ref      || '',
      '_aff_ft_src': ft.source   || '',
      '_aff_ft_med': ft.medium   || '',
      '_aff_ft_cam': ft.campaign || '',
      '_aff_ft_ts':  ft.ts       || '',
      '_aff_lt_ref': lt.ref      || '',
      '_aff_lt_src': lt.source   || '',
      '_aff_lt_med': lt.medium   || '',
      '_aff_lt_cam': lt.campaign || '',
      '_aff_lt_ts':  lt.ts       || '',
      '_aff_touches': String(data.touch_count || 1),
    };

    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes: attrs }),
      credentials: 'same-origin',
    }).catch(function () {});
  }

  // ── Main logic ───────────────────────────────────────────────────────────────
  var incoming = readParams();
  var stored   = load();

  if (incoming) {
    var updated;

    if (!stored) {
      // Brand-new session — set both first and last touch to this visit
      updated = {
        first_touch: incoming,
        last_touch:  incoming,
        touch_count: 1,
        window_days: WINDOW_DAYS,
      };
    } else {
      // Returning with a new tracked URL — keep first touch, update last touch
      updated = {
        first_touch: stored.first_touch || stored,
        last_touch:  incoming,
        touch_count: (stored.touch_count || 1) + 1,
        window_days: stored.window_days || WINDOW_DAYS,
      };
    }

    save(updated);
    writeCartAttributes(updated);

  } else if (stored) {
    // No new UTM on this page, but we have stored attribution — re-write cart
    // attributes in case the cart was reset (e.g. new session, cleared cookies)
    writeCartAttributes(stored);
  }
})();
