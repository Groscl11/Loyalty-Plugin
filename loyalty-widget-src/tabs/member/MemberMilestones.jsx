/**
 * MemberMilestones — GoSelf Loyalty Widget V6
 * Timeline: completed → current (with progress bar) → future.
 */

import React from 'react';
import { formatPoints } from '../../utils/formatPoints.js';

const MemberMilestones = React.memo(function MemberMilestones({ data, config }) {
  const milestones = data.milestones || [];
  const balance    = data.customer?.pointsBalance || 0;

  // Find first incomplete milestone as "current"
  const currentIdx = milestones.findIndex(m => !m.completed);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 24px' }}>

        {milestones.length === 0 && (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, paddingTop: 40 }}>
            No milestones set up yet.
          </div>
        )}

        {milestones.map((m, i) => {
          const isCurrent   = i === currentIdx;
          const isCompleted = m.completed;
          const isFuture    = !isCompleted && !isCurrent;

          // Progress pct for current milestone
          const prevThreshold = i > 0 ? milestones[i - 1].threshold : 0;
          const progress = isCurrent
            ? Math.min(100, Math.round(((balance - prevThreshold) / Math.max(1, m.threshold - prevThreshold)) * 100))
            : 0;

          const iconBg   = isCompleted ? '#16a34a' : isCurrent ? config.accentColor : '#e5e7eb';
          const iconColor = isCompleted || isCurrent ? '#fff' : '#9ca3af';
          const textColor = isFuture ? '#9ca3af' : '#111827';

          return (
            <div key={m.id || i} style={{ display: 'flex', gap: 12, marginBottom: 4, position: 'relative' }}>

              {/* Vertical connector line */}
              {i < milestones.length - 1 && (
                <div
                  style={{
                    position: 'absolute',
                    left: 16,
                    top: 38,
                    bottom: -4,
                    width: 2,
                    background: isCompleted ? '#bbf7d0' : '#e5e7eb',
                  }}
                />
              )}

              {/* Icon bubble */}
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  background: isCurrent ? 'transparent' : iconBg,
                  border: isCurrent ? `2px solid ${config.accentColor}` : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  color: iconColor,
                  fontSize: isCompleted ? 14 : 16,
                  zIndex: 1,
                }}
              >
                {isCompleted ? '✓' : isCurrent ? (m.icon || '⭐') : (m.icon || '●')}
              </div>

              {/* Content */}
              <div style={{ flex: 1, paddingBottom: 18 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: textColor }}>{m.title}</div>
                {m.reward && (
                  <div style={{ fontSize: 11, color: isCompleted ? '#16a34a' : isCurrent ? config.accentColor : '#9ca3af', marginTop: 2 }}>
                    🎁 {m.reward}
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                  {formatPoints(m.threshold, config)} needed
                </div>

                {/* Progress bar for current milestone */}
                {isCurrent && (
                  <div style={{ marginTop: 8 }}>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 99,
                        background: '#e5e7eb',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${progress}%`,
                          height: '100%',
                          background: config.accentColor,
                          borderRadius: 99,
                          transition: 'width 0.6s ease',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 10, color: '#6b7280' }}>
                      <span>{progress}% complete</span>
                      <span>{formatPoints(Math.max(0, m.threshold - balance), config)} to go</span>
                    </div>
                  </div>
                )}

                {isCompleted && m.completedAt && (
                  <div style={{ fontSize: 10, color: '#16a34a', marginTop: 3 }}>✓ Achieved {m.completedAt}</div>
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
