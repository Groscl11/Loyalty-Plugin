/**
 * GuestBanner — GoSelf Loyalty Widget V6
 * Informational banner strip shown to guests below the header.
 */

import React from 'react';

const GuestBanner = React.memo(function GuestBanner({ config, onGate }) {
  return (
    <div
      style={{
        flexShrink: 0,
        backgroundColor: config.heroBannerBg,
        color: config.heroBannerTc,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        fontSize: 12,
      }}
    >
      <div>
        <div style={{ fontWeight: 600, marginBottom: 1 }}>
          Explore the rewards program below
        </div>
        <div style={{ opacity: 0.8 }}>
          Sign in to earn &amp; redeem rewards
        </div>
      </div>
      <button
        onClick={() => onGate('sign in')}
        style={{
          flexShrink: 0,
          background: config.accentColor,
          color: '#fff',
          border: 'none',
          borderRadius: 20,
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Sign in →
      </button>
    </div>
  );
});

export default GuestBanner;
