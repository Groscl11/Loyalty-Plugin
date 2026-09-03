/**
 * GuestMilestones — preview of milestone rewards for guests.
 * Token-aligned with the new design. CTA triggers SignupGate.
 */

import React from 'react';
import { tokens, fmtPts } from '../../utils/tokens.js';

const GuestMilestones = React.memo(function GuestMilestones({ data, config, onGate }) {
  if (!config.showMilestones) return null;

  const milestones = data.milestones || [];

  return (
    <div style={{ padding: '16px 16px 24px', background: tokens.surface }}>

      <div style={{ fontSize: 22, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>
        🏆 Milestone rewards
      </div>
      <div style={{ fontSize: 13, color: tokens.textMuted, marginBottom: 20 }}>
        Hit these thresholds to unlock rewards.
      </div>

      {/* Timeline */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        {milestones.map((m, idx) => (
          <div key={m.id} style={{ display: 'flex', gap: 14, marginBottom: 16, position: 'relative' }}>
            {idx < milestones.length - 1 && (
              <div style={{
                position: 'absolute', left: 16, top: 38, bottom: -8,
                width: 2, background: tokens.border,
              }} />
            )}
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: tokens.borderSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0, zIndex: 1,
            }}>
              {m.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: tokens.text }}>
                {m.title || m.label}
              </div>
              <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 2 }}>
                {fmtPts(m.threshold ?? m.pointsRequired ?? 0)} {config.pointsAbbrev || 'pts'} required
              </div>
              <div style={{ fontSize: 12, color: tokens.warning, fontWeight: 600, marginTop: 2 }}>
                🎁 {m.reward}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => onGate('start earning towards milestones')}
        style={{
          width: '100%', padding: 14,
          background: config.accentColor, color: '#fff',
          border: 'none', borderRadius: tokens.radiusLg,
          fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}
      >
        Sign in to start earning →
      </button>
    </div>
  );
});

export default GuestMilestones;
