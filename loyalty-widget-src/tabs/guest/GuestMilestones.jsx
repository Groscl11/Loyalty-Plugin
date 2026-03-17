/**
 * GuestMilestones — GoSelf Loyalty Widget V6
 * All milestones in a timeline, with a single join CTA.
 * Rendered only when config.showMilestones is true.
 */

import React from 'react';

const GuestMilestones = React.memo(function GuestMilestones({ data, config, onGate }) {
  if (!config.showMilestones) return null;

  const milestones = data.milestones || [];

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: '#111827', marginBottom: 16 }}>
        🏆 Milestone Rewards
      </div>

      {/* Timeline */}
      <div style={{ position: 'relative' }}>
        {milestones.map((m, idx) => (
          <div key={m.id} style={{ display: 'flex', gap: 14, marginBottom: 16, position: 'relative' }}>
            {/* Left connector line */}
            {idx < milestones.length - 1 && (
              <div
                style={{
                  position: 'absolute',
                  left: 16,
                  top: 38,
                  bottom: -8,
                  width: 2,
                  background: '#e5e7eb',
                }}
              />
            )}

            {/* Icon bubble */}
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: '#f3f4f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                flexShrink: 0,
                zIndex: 1,
              }}
            >
              {m.icon}
            </div>

            {/* Content */}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#374151' }}>{m.title || m.label}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                {Number(m.threshold ?? m.pointsRequired ?? 0).toLocaleString('en-IN')} {config.pointsAbbrev} required
              </div>
              <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginTop: 2 }}>
                🎁 {m.reward}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => onGate('start earning towards milestones')}
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
          marginTop: 8,
        }}
      >
        🏆 Start Earning Towards These
      </button>
    </div>
  );
});

export default GuestMilestones;
