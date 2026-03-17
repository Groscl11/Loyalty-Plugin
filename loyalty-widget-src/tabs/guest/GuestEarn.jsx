/**
 * GuestEarn — GoSelf Loyalty Widget V6
 * Shows all earn rules. Gate fires on "Join →" button click only.
 */

import React from 'react';

const GuestEarn = React.memo(function GuestEarn({ data, config, onGate }) {
  const earnRules = data.earnRules || data.merchant?.earnRules || [];

  if (earnRules.length === 0) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9ca3af' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🌟</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Earn rules coming soon</div>
        <div style={{ fontSize: 12 }}>Check back shortly — earning opportunities will appear here.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 16px 24px' }}>

      {/* Info strip — not a gate */}
      <div
        style={{
          background: '#f0f9ff',
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: 12,
          color: '#0369a1',
          marginBottom: 16,
          border: '1px solid #bae6fd',
        }}
      >
        💡 Join the program to start earning {config.pointsNoun} automatically on every order.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {earnRules.map(rule => (
          <EarnRuleRow key={rule.id} rule={rule} config={config} onGate={onGate} />
        ))}
      </div>
    </div>
  );
});

function EarnRuleRow({ rule, config, onGate }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: '#fff',
        border: '1px solid #f3f4f6',
        borderRadius: 12,
        marginBottom: 8,
      }}
    >
      <span style={{ fontSize: 26, width: 32, textAlign: 'center', flexShrink: 0 }}>
        {rule.icon}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{rule.name || rule.label}</div>
        <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 500, marginTop: 1 }}>
          {rule.pointValue || (rule.points_reward > 0 ? `+${Number(rule.points_reward).toLocaleString('en-IN')} pts` : '')}
        </div>
      </div>
      {rule.featured ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <span
            style={{
              background: '#f59e0b',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              borderRadius: 4,
              padding: '2px 6px',
              textTransform: 'uppercase',
            }}
          >
            Popular
          </span>
          <button
            onClick={() => onGate(rule.label.toLowerCase())}
            style={joinBtn(config.accentColor)}
          >
            Start
          </button>
        </div>
      ) : (
        <button
          onClick={() => onGate(rule.label.toLowerCase())}
          style={joinBtn(config.accentColor)}
        >
          Join →
        </button>
      )}
    </div>
  );
}

const joinBtn = (color) => ({
  background: color,
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export default GuestEarn;
