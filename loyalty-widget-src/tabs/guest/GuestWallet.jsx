/**
 * GuestWallet — GoSelf Loyalty Widget V6
 * Informational state for guests — no real wallet data to show yet.
 */

import React from 'react';

const GuestWallet = React.memo(function GuestWallet({ config, onGate }) {
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 52, marginBottom: 14 }}>💳</div>

      <div style={{ fontWeight: 700, fontSize: 17, color: '#111827', marginBottom: 6 }}>
        Your Wallet
      </div>

      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 24, lineHeight: 1.5 }}>
        Earn {config.pointsNoun} and redeem them for discount codes, free products, and partner offers — all saved here.
      </div>

      <button
        onClick={() => onGate('access your wallet and start redeeming')}
        style={{
          width: '100%',
          maxWidth: 260,
          padding: '13px 0',
          background: config.accentColor,
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        🔓 Unlock Your Wallet
      </button>
    </div>
  );
});

export default GuestWallet;
