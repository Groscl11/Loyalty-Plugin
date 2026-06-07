/**
 * PanelHeader — GoSelf Loyalty Widget V6
 * Gradient header strip with back/close buttons and welcome text.
 */

import React from 'react';

// forwardRef required so LoyaltyWidget can move focus into the header on panel open
const PanelHeader = React.memo(React.forwardRef(function PanelHeader({
  config,
  activeTab,
  isGuest,
  customerFirstName,
  customerTier,
  customerTierName,
  customerPoints,
  onBack,
  onClose,
  storeName,
}, ref) {
  const canGoBack = !isGuest && activeTab !== 'home';

  let subtitle;
  if (isGuest) {
    subtitle = 'Explore · Sign up to unlock';
  } else {
    // Prefer the merchant's exact configured tier name (e.g. "Earth"); then any
    // tierNames mapping; then a capitalised key. Never invent a "Bronze" fallback —
    // if there's no tier, show points only.
    const tierLabel =
      customerTierName ||
      config.tierNames?.[customerTier] ||
      (customerTier ? customerTier.charAt(0).toUpperCase() + customerTier.slice(1) : '');
    const ptsLabel  = customerPoints != null
      ? `${Number(customerPoints).toLocaleString()} ${config.pointsAbbrev || 'pts'}`
      : null;
    subtitle = [tierLabel, ptsLabel].filter(Boolean).join(' · ') || `${customerFirstName || 'Member'}'s Rewards`;
  }

  return (
    <div
      style={{
        flexShrink: 0,
        background: `linear-gradient(135deg, ${config.accentColor} 0%, ${adjustColor(config.accentColor, -30)} 100%)`,
        padding: '14px 16px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      {/* Left: back button or spacer */}
      <div style={{ width: 32, flexShrink: 0 }}>
        {canGoBack && (
          <button
            onClick={onBack}
            aria-label="Go back"
            style={circleBtn}
          >
            ←
          </button>
        )}
      </div>

      {/* Center: store name + subtitle */}
      <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            color: '#ffffff',
            fontSize: 15,
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {storeName || 'Rewards'}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.82)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {subtitle}
        </div>
      </div>

      {/* Right: close button — receives forwarded ref for focus management */}
      <div style={{ width: 32, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          ref={ref}
          onClick={onClose}
          aria-label="Close rewards panel"
          style={circleBtn}
        >
          ×
        </button>
      </div>
    </div>
  );
}));

const circleBtn = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(255,255,255,0.22)',
  color: '#ffffff',
  fontSize: 16,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
  padding: 0,
  flexShrink: 0,
};

/**
 * Darken a hex color by `amount` (0-255).
 * Used to create the gradient end-stop.
 */
function adjustColor(hex, amount) {
  const clean = (hex || '#6366f1').replace('#', '');
  const num = parseInt(clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean, 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export default PanelHeader;
