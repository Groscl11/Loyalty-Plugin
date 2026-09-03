/**
 * Design tokens — shared across all widget screens.
 *
 * Migrated visual language from /tmp/goself-widget-mockup.html v2.
 * Colors that change per merchant (accent) come through `config` at render
 * time; everything else lives here.
 */

export const tokens = {
  // Surface
  surface:        '#ffffff',
  bg:             '#f9fafb',
  border:         '#e5e7eb',
  borderSoft:     '#f3f4f6',

  // Text
  text:           '#111827',
  textMuted:      '#6b7280',
  textSubtle:     '#9ca3af',

  // Semantic
  success:        '#10b981',
  successSoft:    '#dcfce7',
  successText:    '#16a34a',
  warning:        '#f59e0b',
  warningSoft:    '#fef3c7',
  warningText:    '#92400e',
  danger:         '#ef4444',
  dangerSoft:     '#fef2f2',

  // Reward-type accents
  partner:        '#db2777',
  partnerSoft:    '#fce7f3',
  marketplace:    '#0ea5e9',
  marketplaceSoft:'#e0f2fe',

  // Tier colours (matching mockup tier card)
  bronzeBg:       'linear-gradient(135deg, #fef3c7, #fcd9b6)',
  bronzeText:     '#78350f',
  bronzeAccent:   '#92400e',
  silverBg:       'linear-gradient(135deg, #f3f4f6, #d1d5db)',
  silverText:     '#374151',
  silverAccent:   '#1f2937',
  goldBg:         'linear-gradient(135deg, #fef3c7, #fbbf24)',
  goldText:       '#78350f',
  goldAccent:     '#b45309',
  platinumBg:     'linear-gradient(135deg, #e0e7ff, #a5b4fc)',
  platinumText:   '#312e81',
  platinumAccent: '#4338ca',

  // Spacing
  radiusSm:       6,
  radiusMd:       8,
  radiusLg:       12,
  radiusXl:       16,
  panelRadius:    18,

  // Shadows
  shadowSm:       '0 2px 8px rgba(0,0,0,0.06)',
  shadowMd:       '0 10px 40px rgba(0,0,0,0.12)',
  shadowLg:       '0 20px 60px rgba(0,0,0,0.18)',

  // Pill button shadow
  pillShadow:     '0 8px 30px rgba(0,0,0,0.16)',

  // Animation
  animMs:         220,
};

/**
 * Tier visual lookup by known key. Returns { bg, text, accent, emoji }.
 * Falls back to bronze for unrecognised keys.
 */
export function tierStyle(tierKey) {
  const t = (tierKey || 'bronze').toLowerCase();
  if (t === 'silver')   return { bg: tokens.silverBg,   text: tokens.silverText,   accent: tokens.silverAccent,   emoji: '🥈' };
  if (t === 'gold')     return { bg: tokens.goldBg,     text: tokens.goldText,     accent: tokens.goldAccent,     emoji: '🥇' };
  if (t === 'platinum') return { bg: tokens.platinumBg, text: tokens.platinumText, accent: tokens.platinumAccent, emoji: '💎' };
  return { bg: tokens.bronzeBg, text: tokens.bronzeText, accent: tokens.bronzeAccent, emoji: '🥉' };
}

/**
 * Position-based tier styling — works for any merchant tier name.
 * index 0 = lowest tier (bronze), 1 = silver, 2 = gold, 3+ = platinum.
 * Use when merchant uses custom tier names that won't match tierStyle's key list.
 */
export function tierStyleByIndex(index) {
  if (index === 1) return { bg: tokens.silverBg,   text: tokens.silverText,   accent: tokens.silverAccent,   emoji: '🥈' };
  if (index === 2) return { bg: tokens.goldBg,     text: tokens.goldText,     accent: tokens.goldAccent,     emoji: '🥇' };
  if (index >= 3)  return { bg: tokens.platinumBg, text: tokens.platinumText, accent: tokens.platinumAccent, emoji: '💎' };
  return { bg: tokens.bronzeBg, text: tokens.bronzeText, accent: tokens.bronzeAccent, emoji: '🥉' };
}

/**
 * Returns an opaque-on-white tint variant of the accent colour (e.g. 'eef2ff'
 * for indigo). Used for soft-coloured CTA card backgrounds.
 */
export function accentSoft(hex) {
  try {
    const c = (hex || '#6366f1').replace('#', '');
    const num = parseInt(c, 16);
    const r = (num >> 16) & 0xff;
    const g = (num >> 8) & 0xff;
    const b = num & 0xff;
    // Mix 92% white + 8% accent
    const blend = (channel) => Math.round(channel * 0.08 + 255 * 0.92);
    return `rgb(${blend(r)}, ${blend(g)}, ${blend(b)})`;
  } catch { return '#eef2ff'; }
}

/**
 * Generate tier card visuals from an admin-configured hex color.
 * Creates a light-to-base gradient and derives readable text/accent colors.
 * The emoji is intentionally omitted here — callers should merge in the
 * position-based emoji from tierStyleByIndex so it stays contextually correct.
 */
export function tierStyleFromColor(hex) {
  const base = (hex || '#6366f1').replace(/[^0-9a-fA-F#]/g, '');
  const clean = base.replace('#', '').padEnd(6, '0');
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8)  & 0xff;
  const b = num         & 0xff;

  // Light version — 70 % white + 30 % base (soft card start colour)
  const mix = (ch) => Math.round(ch * 0.30 + 255 * 0.70);
  const lHex = `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2,'0')).join('')}`;

  // Dark version — 45 % of base (used for text & accent, keeps contrast)
  const dark = (ch) => Math.max(0, Math.round(ch * 0.45));
  const dHex = `#${[dark(r), dark(g), dark(b)].map(v => v.toString(16).padStart(2,'0')).join('')}`;

  return {
    bg:     `linear-gradient(135deg, ${lHex}, ${base})`,
    text:   dHex,
    accent: dHex,
    // emoji provided by caller (tierStyleByIndex) so it stays position-appropriate
  };
}

/**
 * Darken a hex by amount (0-255 range, negative to darken).
 */
export function adjustColor(hex, amount) {
  const clean = (hex || '#6366f1').replace('#', '');
  const num = parseInt(clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean, 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Format points the same way across the whole widget.
 */
export function fmtPts(n) {
  return Number(n || 0).toLocaleString('en-IN');
}
