/**
 * MemberMilestones — vertical timeline of milestone rewards.
 *
 * Reached from Profile hub. Shows completed (with checkmark) → current
 * (with progress bar) → future (greyed out) milestones along a connector
 * line. Token-aligned with the rest of the new design.
 */

import React from 'react';
import { tokens, fmtPts } from '../../utils/tokens.js';

const MemberMilestones = React.memo(function MemberMilestones({ data, config, setTab }) {
  const milestones = data.milestones || [];
  const balance    = data.customer?.pointsBalance || 0;
  const currentIdx = milestones.findIndex(m => !m.completed);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.surface }}>

      {/* Back strip */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px',
        background: tokens.bg,
        borderBottom: `1px solid ${tokens.borderSoft}`,
      }}>
        <button
          onClick={() => setTab && setTab('profile')}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            padding: '4px 8px', borderRadius: tokens.radiusSm,
            color: tokens.text, fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >← Profile</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px' }}>

        <div style={{ fontSize: 22, fontWeight: 600, color: tokens.text, marginBottom: 16 }}>
          Milestones
        </div>

        {milestones.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '40px 0',
            border: `1px dashed ${tokens.border}`, borderRadius: tokens.radiusMd,
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🏆</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>
              No milestones yet
            </div>
            <div style={{ fontSize: 12, color: tokens.textMuted }}>
              Your merchant hasn't set up milestone rewards.
            </div>
          </div>
        )}

        {milestones.map((m, i) => {
          const isCurrent   = i === currentIdx;
          const isCompleted = m.completed;
          const isFuture    = !isCompleted && !isCurrent;

          const prevThreshold = i > 0 ? milestones[i - 1].threshold : 0;
          const progress = isCurrent
            ? Math.min(100, Math.round(((balance - prevThreshold) / Math.max(1, m.threshold - prevThreshold)) * 100))
            : 0;

          return (
            <div key={m.id || i} style={{ display: 'flex', gap: 12, marginBottom: 4, position: 'relative' }}>

              {/* Vertical connector */}
              {i < milestones.length - 1 && (
                <div style={{
                  position: 'absolute', left: 16, top: 38, bottom: -4,
                  width: 2,
                  background: isCompleted ? tokens.successSoft : tokens.border,
                }} />
              )}

              {/* Icon bubble */}
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: isCurrent
                  ? 'transparent'
                  : isCompleted ? tokens.successText
                  : tokens.border,
                border: isCurrent ? `2px solid ${config.accentColor}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                color: isCompleted || isCurrent ? '#fff' : tokens.textSubtle,
                fontSize: isCompleted ? 14 : 16, zIndex: 1,
              }}>
                {isCompleted ? '✓' : isCurrent ? (m.icon || '⭐') : (m.icon || '●')}
              </div>

              <div style={{ flex: 1, paddingBottom: 20 }}>
                <div style={{
                  fontWeight: 600, fontSize: 14,
                  color: isFuture ? tokens.textMuted : tokens.text,
                }}>
                  {m.title}
                </div>
                {m.reward && (
                  <div style={{
                    fontSize: 12, marginTop: 2,
                    color: isCompleted ? tokens.successText
                         : isCurrent   ? config.accentColor
                         : tokens.textSubtle,
                  }}>
                    🎁 {m.reward}
                  </div>
                )}
                <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 2 }}>
                  {fmtPts(m.threshold)} {config.pointsAbbrev || 'pts'} needed
                </div>

                {isCurrent && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{
                      height: 6, borderRadius: 99,
                      background: tokens.border, overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${progress}%`, height: '100%',
                        background: config.accentColor,
                        borderRadius: 99, transition: 'width 0.6s ease',
                      }} />
                    </div>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      marginTop: 4, fontSize: 11, color: tokens.textMuted,
                    }}>
                      <span>{progress}% complete</span>
                      <span>{fmtPts(Math.max(0, m.threshold - balance))} to go</span>
                    </div>
                  </div>
                )}

                {isCompleted && m.completedAt && (
                  <div style={{ fontSize: 11, color: tokens.successText, marginTop: 4, fontWeight: 500 }}>
                    ✓ Achieved {m.completedAt}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default MemberMilestones;
