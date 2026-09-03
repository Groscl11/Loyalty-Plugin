/**
 * GuestWallet — informational empty state for guests.
 * Centered hero + value prop + Sign-in CTA.
 */

import React from 'react';
import { tokens, accentSoft } from '../../utils/tokens.js';

const GuestWallet = React.memo(function GuestWallet({ config, onGate }) {
  return (
    <div style={{
      padding: '40px 24px', textAlign: 'center',
      background: tokens.surface, height: '100%',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
    }}>
      <div style={{
        display: 'inline-block', fontSize: 52,
        width: 96, height: 96, lineHeight: '96px',
        background: accentSoft(config.accentColor),
        borderRadius: '50%', margin: '0 auto 16px',
      }}>
        💼
      </div>

      <div style={{ fontSize: 20, fontWeight: 700, color: tokens.text, marginBottom: 6 }}>
        Your wallet
      </div>

      <div style={{
        fontSize: 13, color: tokens.textMuted,
        marginBottom: 24, lineHeight: 1.5,
        maxWidth: 280, margin: '0 auto 24px',
      }}>
        Earn {config.pointsNoun || 'points'} and redeem them for discount codes, free products, and partner offers — all saved here.
      </div>

      <div style={{ maxWidth: 260, width: '100%', margin: '0 auto' }}>
        <button
          onClick={() => onGate('access your wallet and start redeeming')}
          style={{
            width: '100%', padding: 13,
            background: config.accentColor, color: '#fff',
            border: 'none', borderRadius: tokens.radiusLg,
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Sign in to unlock
        </button>
      </div>
    </div>
  );
});

export default GuestWallet;
