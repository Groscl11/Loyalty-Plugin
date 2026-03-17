/**
 * GuestHome — GoSelf Loyalty Widget V6
 * Hero card, top earn actions, milestones, partner brands, and CTA.
 */

import React from 'react';
import { formatPoints } from '../../utils/formatPoints.js';
import { interpolate } from '../../utils/interpolate.js';

const GuestHome = React.memo(function GuestHome({ data, config, onGate, setTab }) {
  const earnRules   = data.merchant?.earnRules   || [];
  const milestones  = data.milestones?.slice(0, 3) || [];
  const partners    = data.merchant?.partnerBrands || [];

  return (
    <div style={{ padding: '16px 16px 24px' }}>

      {/* Hero card */}
      <div
        style={{
          background: `linear-gradient(135deg, ${config.accentColor} 0%, ${shiftHue(config.accentColor)} 100%)`,
          borderRadius: 14,
          padding: '18px 18px 16px',
          color: '#fff',
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>
          {config.guestHeadline}
        </div>
        <div style={{ fontSize: 12, opacity: 0.88, marginBottom: 14 }}>
          {config.guestSubline}
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12 }}>
          <StatPill label={`1 ${config.pointsAbbrev} per ₹1`} icon="🛍️" />
          <StatPill label={`+200 ${config.pointsAbbrev} referral`} icon="👥" />
          <StatPill label={`Tier rewards`} icon="🏆" />
        </div>
      </div>

      {/* Top earn actions */}
      {earnRules.length > 0 && (
        <Section title={`Ways to earn ${config.pointsNoun}`}>
          {earnRules.slice(0, 4).map(rule => (
            <EarnRow key={rule.id} rule={rule} />
          ))}
        </Section>
      )}

      {/* Milestones preview */}
      {milestones.length > 0 && (
        <Section title="Milestone gifts">
          {milestones.map(m => (
            <MilestoneRow key={m.id} milestone={m} />
          ))}
        </Section>
      )}

      {/* Partner brands */}
      {config.showPartnerBrands && partners.length > 0 && (
        <Section title="Partner brands">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {partners.map(pb => (
              <div
                key={pb.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#374151',
                }}
              >
                {pb.name}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Primary CTA */}
      <button
        onClick={() => onGate('join the rewards program')}
        style={{
          width: '100%',
          padding: '14px 0',
          background: config.accentColor,
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          fontSize: 15,
          fontWeight: 700,
          cursor: 'pointer',
          marginTop: 8,
          marginBottom: 10,
        }}
      >
        🚀 Join Free — Start Earning Now
      </button>

      <div style={{ textAlign: 'center', fontSize: 12, color: '#6b7280' }}>
        Already have an account?{' '}
        <button
          onClick={() => onGate('sign in to your account')}
          style={{ background: 'none', border: 'none', color: config.accentColor, fontWeight: 600, cursor: 'pointer', fontSize: 12, padding: 0 }}
        >
          Sign in →
        </button>
      </div>
    </div>
  );
});

function StatPill({ label, icon }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.2)',
        borderRadius: 20,
        padding: '4px 10px',
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function EarnRow({ rule }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
      <span style={{ fontSize: 22, width: 28, textAlign: 'center', flexShrink: 0 }}>{rule.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{rule.label}</div>
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', whiteSpace: 'nowrap' }}>
        {rule.pointValue}
      </div>
    </div>
  );
}

function MilestoneRow({ milestone }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
      <span style={{ fontSize: 22, width: 28, textAlign: 'center', flexShrink: 0 }}>{milestone.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{milestone.label}</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>{milestone.reward}</div>
      </div>
    </div>
  );
}

function shiftHue(hex) {
  try {
    const c = (hex || '#6366f1').replace('#', '');
    const n = parseInt(c, 16);
    const r = Math.max(0, ((n >> 16) & 0xff) - 40);
    const g = Math.max(0, ((n >> 8)  & 0xff) - 10);
    const b = Math.min(255, (n & 0xff) + 30);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  } catch { return '#4f46e5'; }
}

export default GuestHome;
