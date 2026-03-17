/**
 * MemberHome — GoSelf Loyalty Widget V6
 * Dashboard: points hero, ledger summary, survey nudge, next milestone, quick nav.
 */

import React, { useMemo } from 'react';
import { formatPoints } from '../../utils/formatPoints.js';
import { interpolate } from '../../utils/interpolate.js';

const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum'];

const MemberHome = React.memo(function MemberHome({
  data,
  config,
  setTab,
  openSurvey,
}) {
  const { customer, merchant, history, milestones, survey } = data;

  // Ledger aggregates — use lifetime totals from API when available, otherwise
  // compute from the local transaction history cache
  const totalEarned = useMemo(() => {
    if (customer.lifetimeEarned > 0) return customer.lifetimeEarned;
    return history.filter(t => t.type === 'earn').reduce((s, t) => s + (t.delta || 0), 0);
  }, [customer.lifetimeEarned, history]);
  const totalRedeemed = useMemo(() => {
    if (customer.lifetimeRedeemed > 0) return customer.lifetimeRedeemed;
    return history.filter(t => t.type === 'redeem').reduce((s, t) => s + Math.abs(t.delta || 0), 0);
  }, [customer.lifetimeRedeemed, history]);

  // Tier progress
  const currentTier  = customer.tier || 'bronze';
  const nextTierKey  = TIER_ORDER[TIER_ORDER.indexOf(currentTier) + 1];
  const nextTierThreshold = nextTierKey ? merchant.tierThresholds?.[nextTierKey] || 0 : null;
  const currentThreshold  = merchant.tierThresholds?.[currentTier] || 0;
  const ptsToNext = nextTierThreshold ? Math.max(0, nextTierThreshold - customer.pointsBalance) : 0;
  const progressPct = nextTierThreshold
    ? Math.min(100, Math.round(((customer.pointsBalance - currentThreshold) / (nextTierThreshold - currentThreshold)) * 100))
    : 100;

  // Next incomplete milestone
  const nextMilestone = milestones.find(m => !m.isCompleted);

  // Quick nav tiles
  const quickNav = [
    { id: 'earn',       icon: '🪙', label: 'Earn' },
    { id: 'redeem',     icon: '🎁', label: 'Redeem' },
    { id: 'wallet',     icon: '💳', label: 'Wallet' },
    config.showReferTab    && { id: 'refer',      icon: '📣', label: 'Refer' },
    config.showMilestones  && { id: 'milestones', icon: '🏆', label: 'Milestones' },
    { id: 'profile',    icon: '👤', label: 'Profile' },
  ].filter(Boolean);

  return (
    <div style={{ padding: '0 0 24px' }}>

      {/* Points hero card */}
      <div
        style={{
          background: `linear-gradient(135deg, ${config.accentColor} 0%, #7c3aed 100%)`,
          padding: '18px 18px 16px',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 4 }}>
              {interpolate(config.welcomeMsg, { firstName: customer.firstName || 'there' })}
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>
              {Number(customer.pointsBalance).toLocaleString('en-IN')}
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 3 }}>
              {config.pointsNoun} balance
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            {/* Tier badge */}
            <div
              style={{
                background: 'rgba(255,255,255,0.22)',
                borderRadius: 16,
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span>🏅</span>
              <span>{config.tierNames[currentTier] || currentTier}</span>
            </div>
          </div>
        </div>

        {/* Tier progress bar */}
        {nextTierThreshold && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 5 }}>
              {formatPoints(ptsToNext, config)} to {config.tierNames[nextTierKey] || nextTierKey}
            </div>
            <div style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 4, height: 6 }}>
              <div
                style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  background: '#ffffff',
                  borderRadius: 4,
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '0 16px' }}>

        {/* Ledger summary row */}
        <button
          onClick={() => setTab('history')}
          style={{
            width: '100%',
            display: 'flex',
            background: '#f9fafb',
            border: '1px solid #f3f4f6',
            borderRadius: 12,
            padding: '12px 14px',
            marginTop: 14,
            cursor: 'pointer',
            gap: 8,
          }}
        >
          <LedgerCell label="Earned" value={`+${Number(totalEarned).toLocaleString('en-IN')}`} color="#16a34a" />
          <div style={{ width: 1, background: '#e5e7eb', margin: '0 4px' }} />
          <LedgerCell label="Redeemed" value={`-${Number(totalRedeemed).toLocaleString('en-IN')}`} color="#ef4444" />
          <div style={{ width: 1, background: '#e5e7eb', margin: '0 4px' }} />
          <LedgerCell label="Balance" value={Number(customer.pointsBalance).toLocaleString('en-IN')} color={config.accentColor} />
          <span style={{ color: '#9ca3af', fontSize: 16, alignSelf: 'center', marginLeft: 'auto' }}>›</span>
        </button>

        {/* Survey nudge */}
        {config.showSurvey && survey?.questions?.length > 0 && (
          <button
            onClick={openSurvey}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 12,
              padding: '12px 14px',
              marginTop: 10,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 22 }}>📋</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#92400e' }}>
                {survey.headline || `Quick survey — earn ${survey.rewardPts} ${config.pointsAbbrev}!`}
              </div>
              <div style={{ fontSize: 11, color: '#a16207', marginTop: 2 }}>
                {survey.questions.length} questions · 1 min
              </div>
            </div>
            <span style={{ color: '#f59e0b', fontSize: 16 }}>›</span>
          </button>
        )}

        {/* Next milestone */}
        {nextMilestone && (
          <button
            onClick={() => setTab('milestones')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: 12,
              padding: '12px 14px',
              marginTop: 10,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 22 }}>{nextMilestone.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Next: {nextMilestone.label}
              </div>
              <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>
                {Number(nextMilestone.pointsRequired).toLocaleString('en-IN')} {config.pointsAbbrev} → {nextMilestone.reward}
              </div>
            </div>
            <span style={{ color: '#9ca3af', fontSize: 16 }}>›</span>
          </button>
        )}

        {/* Quick nav grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 16 }}>
          {quickNav.map(tile => (
            <button
              key={tile.id}
              onClick={() => setTab(tile.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '12px 8px',
                background: '#f9fafb',
                border: '1px solid #f3f4f6',
                borderRadius: 12,
                cursor: 'pointer',
                gap: 6,
              }}
            >
              <span style={{ fontSize: 22 }}>{tile.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: '#374151' }}>{tile.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

function LedgerCell({ label, value, color }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontWeight: 700, fontSize: 14, color }}>{value}</div>
      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default MemberHome;
