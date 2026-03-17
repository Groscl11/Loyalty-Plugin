/**
 * LoyaltyButton — GoSelf Loyalty Widget V6
 * Floating pill button with optional shake animation, points badge, notify dot.
 */

import React, { useEffect, useRef } from 'react';
import { useShake } from './hooks/useShake.js';
import { formatPoints } from './utils/formatPoints.js';

const SHAKE_KEYFRAMES = `
@keyframes widgetShake {
  0%,100%{transform:translateX(0)}
  15%{transform:translateX(-5px)}
  30%{transform:translateX(5px)}
  45%{transform:translateX(-4px)}
  60%{transform:translateX(4px)}
  75%{transform:translateX(-2px)}
  90%{transform:translateX(2px)}
}
@keyframes notifyPulse {
  0%,100%{transform:scale(1);opacity:1}
  50%{transform:scale(1.35);opacity:0.7}
}
@keyframes gsSpin {
  from{transform:rotate(0deg)}
  to{transform:rotate(360deg)}
}
`;

const LoyaltyButton = React.memo(function LoyaltyButton({
  config,
  isGuest,
  pointsBalance,
  notifyDot,
  panelOpen,
  onClick,
}) {
  const shaking   = useShake(config.shakeOnLoad, config.shakeIntervalSec);
  const styleRef  = useRef(null);

  // Inject keyframes once
  useEffect(() => {
    if (styleRef.current) return;
    const tag = document.createElement('style');
    tag.setAttribute('data-goself-anim', '1');
    tag.textContent = SHAKE_KEYFRAMES;
    document.head.appendChild(tag);
    styleRef.current = tag;
    return () => {
      if (styleRef.current && document.head.contains(styleRef.current)) {
        document.head.removeChild(styleRef.current);
      }
      styleRef.current = null;
    };
  }, []);

  const positionKey = config.widgetPosition === 'left' ? 'left' : 'right';
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const showPoints = !isGuest && config.showPointsOnBtn;

  return (
    <button
      onClick={onClick}
      aria-label={panelOpen ? 'Close rewards panel' : (config.widgetLabel || 'Open rewards panel')}
      aria-expanded={panelOpen}
      style={{
        position: 'fixed',
        bottom: 14,
        [positionKey]: 14,
        zIndex: 2147483646,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: showPoints ? '10px 14px 10px 12px' : '10px 16px',
        borderRadius: 50,
        border: 'none',
        background: `linear-gradient(135deg, ${config.accentColor}, ${shiftHue(config.accentColor, -20)})`,
        color: '#fff',
        fontWeight: 700,
        fontSize: 13,
        cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
        animation: (!reducedMotion && shaking && !panelOpen) ? 'widgetShake 0.6s ease' : 'none',
        transition: 'transform 0.18s ease, opacity 0.18s ease',
        outline: 'none',
        userSelect: 'none',
      }}
    >
      {/* Notify dot */}
      {notifyDot && !panelOpen && (
        <span
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: '#ef4444',
            border: '2px solid #fff',
            animation: reducedMotion ? 'none' : 'notifyPulse 1.4s ease infinite',
          }}
        />
      )}

      {/* Icon */}
      <span style={{ fontSize: 16, lineHeight: 1 }}>{panelOpen ? '✕' : '🎁'}</span>

      {/* Label */}
      <span>{config.widgetLabel || 'Rewards'}</span>

      {/* Points badge */}
      {showPoints && (
        <span
          style={{
            background: 'rgba(255,255,255,0.22)',
            borderRadius: 99,
            padding: '2px 8px',
            fontSize: 11,
            fontWeight: 700,
            marginLeft: 2,
          }}
        >
          {formatPoints(pointsBalance, config)}
        </span>
      )}
    </button>
  );
});

/**
 * Shift the hue of a hex color by `amount` degrees.
 * Used for gradient end-stop.
 */
function shiftHue(hex, amount) {
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Simple brightness shift as fallback
    const clamp = n => Math.max(0, Math.min(255, n));
    const dr = clamp(r + amount * 1.2);
    const dg = clamp(g + amount * 0.8);
    const db = clamp(b + amount * 0.5);
    return `#${[dr,dg,db].map(x => Math.round(x).toString(16).padStart(2,'0')).join('')}`;
  } catch (_) {
    return hex;
  }
}

export default LoyaltyButton;
