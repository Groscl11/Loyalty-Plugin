/**
 * GuestEarn — earn rules shown locked for unauthenticated visitors.
 * Rules are visible (opacity 0.65) with a lock icon — teasing what members get.
 * Action buttons redirect to /account/login via onGate.
 */

import React from 'react';
import { tokens, accentSoft, fmtPts } from '../../utils/tokens.js';

const GuestEarn = React.memo(function GuestEarn({ data, config, onGate }) {
  const earnRules = data.earnRules || data.merchant?.earnRules || [];

  if (earnRules.length === 0) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: tokens.textMuted, background: tokens.surface }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🌟</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 8 }}>
          Ways to earn coming soon
        </div>
        <button
          onClick={() => onGate('sign in')}
          style={{
            background: config.accentColor, color: '#fff',
            border: 'none', borderRadius: tokens.radiusMd,
            padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            marginTop: 8,
          }}
        >
          Sign in to check back →
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.surface }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 80px' }}>

        <div style={{ fontSize: 22, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>
          Ways to earn
        </div>
        <div style={{ fontSize: 13, color: tokens.textMuted, marginBottom: 16 }}>
          Sign in to start earning {config.pointsNoun || 'points'} automatically.
        </div>

        {earnRules.map(rule => (
          <LockedEarnRow key={rule.id} rule={rule} config={config} onGate={onGate} />
        ))}
      </div>

      {/* ─── Sticky unlock bar ───────────────────────────────────────── */}
      <div style={{
        position: 'sticky', bottom: 0,
        background: tokens.surface,
        borderTop: `1px solid ${tokens.border}`,
        padding: '12px 16px',
        flexShrink: 0,
      }}>
        <button
          onClick={() => onGate('start earning points')}
          style={{
            width: '100%', padding: 13,
            background: config.accentColor, color: '#fff',
            border: 'none', borderRadius: tokens.radiusLg,
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          🔓 Sign in to unlock all rewards
        </button>
      </div>
    </div>
  );
});

function LockedEarnRow({ rule, config, onGate }) {
  const pts = rule.pointValue
    || (rule.points_reward > 0 ? `+${fmtPts(rule.points_reward)} ${config.pointsAbbrev || 'pts'}` : '');

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: 14, background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radiusLg, marginBottom: 10,
        opacity: 0.72,
        position: 'relative',
      }}
    >
      {/* Lock overlay badge */}
      <div style={{
        position: 'absolute', top: 8, right: 8,
        fontSize: 12, color: tokens.textSubtle,
      }}>
        🔒
      </div>

      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: accentSoft(config.accentColor),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, flexShrink: 0,
      }}>
        {rule.icon || '✨'}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingRight: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>
          {rule.name || rule.label}
        </div>
        {rule.featured && (
          <span style={{
            display: 'inline-block', marginTop: 4, marginRight: 6,
            background: tokens.warning, color: '#fff',
            fontSize: 10, fontWeight: 700, borderRadius: 999,
            padding: '2px 8px', textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            Popular
          </span>
        )}
        {pts && (
          <div style={{ fontSize: 12, color: tokens.successText, fontWeight: 600, marginTop: 4 }}>
            {pts}
          </div>
        )}
      </div>
    </div>
  );
}

export default GuestEarn;
