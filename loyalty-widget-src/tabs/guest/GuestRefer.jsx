/**
 * GuestRefer — GoSelf Loyalty Widget V6
 * Referral hero + monthly prize pool + leaderboard preview.
 * Rendered only when config.showReferTab is true.
 */

import React from 'react';
import { interpolate } from '../../utils/interpolate.js';

const GuestRefer = React.memo(function GuestRefer({ data, config, onGate }) {
  if (!config.showReferTab) return null;

  const leaderboard = data.leaderboard || [];

  return (
    <div style={{ padding: '16px 16px 24px' }}>

      {/* Referral hero */}
      <div
        style={{
          background: `linear-gradient(135deg, ${config.accentColor} 0%, #7c3aed 100%)`,
          borderRadius: 14,
          padding: '18px 18px 16px',
          color: '#fff',
          marginBottom: 16,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 6 }}>📣</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          Refer a Friend
        </div>
        <div style={{ fontSize: 13, opacity: 0.9 }}>
          {interpolate('Give ₹100 · Get 200 {pointsNoun}', config)}
        </div>
      </div>

      {/* Monthly prizes */}
      {config.prizes && config.prizes.length > 0 && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 12,
            padding: '12px 16px',
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e', marginBottom: 10 }}>
            🎖️ Monthly Prizes
          </div>
          {config.prizes.map((p, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 10,
                marginBottom: i < config.prizes.length - 1 ? 8 : 0,
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600, color: p.col, minWidth: 44 }}>{p.rank}</span>
              <span style={{ color: '#374151' }}>— {p.prize}</span>
            </div>
          ))}
        </div>
      )}

      {/* Leaderboard preview */}
      {config.showLeaderboard && leaderboard.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Monthly leaderboard
          </div>
          {leaderboard.slice(0, 3).map(row => (
            <LeaderRow key={row.rank} row={row} config={config} />
          ))}
          {/* Guest CTA row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 14px',
              background: '#f9fafb',
              borderRadius: 10,
              fontSize: 12,
              color: '#9ca3af',
              gap: 8,
            }}
          >
            <span style={{ fontWeight: 700, minWidth: 24, textAlign: 'center' }}>?</span>
            <span style={{ flex: 1 }}>Your spot is open — Join and start referring</span>
          </div>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={() => onGate('get your referral link and start referring')}
        style={{
          width: '100%',
          padding: '14px 0',
          background: config.accentColor,
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        📣 Get My Referral Link →
      </button>
    </div>
  );
});

function LeaderRow({ row, config }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 14px',
        background: '#fff',
        border: '1px solid #f3f4f6',
        borderRadius: 10,
        marginBottom: 6,
        gap: 10,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 13, minWidth: 24, textAlign: 'center', color: '#374151' }}>
        #{row.rank}
      </span>
      <span style={{ flex: 1, fontWeight: 500, fontSize: 13, color: '#111827' }}>{row.name}</span>
      <span style={{ fontSize: 12, color: '#6b7280' }}>{row.referralCount} refs</span>
      <span style={{ fontWeight: 700, fontSize: 13, color: '#16a34a' }}>
        +{Number(row.ptsEarned).toLocaleString('en-IN')}
      </span>
    </div>
  );
}

export default GuestRefer;
