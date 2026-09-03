/**
 * GuestProfile — locked profile hub for unauthenticated visitors.
 *
 * Shows:
 *   1. Locked avatar + "Sign in to view your profile"
 *   2. Profile completion perks (earn rules from DB for birthday/email/etc,
 *      or generic fallback list)
 *   3. Locked quick-links (wallet, history, milestones)
 *   4. Primary CTA → /account/login
 */

import React, { useMemo } from 'react';
import { tokens, accentSoft, fmtPts } from '../../utils/tokens.js';

// Detect profile-completion type earn rules from the DB earn rules list
function extractProfilePerks(earnRules, config) {
  const ptsAbbrev = config.pointsAbbrev || 'pts';
  const rules = earnRules || [];

  const profileCategories = [
    { pattern: /birthday|b-day/i, icon: '🎂', fallbackLabel: 'Birthday bonus', fallbackPts: `Bonus ${ptsAbbrev} on your birthday` },
    { pattern: /anniver/i,         icon: '🎉', fallbackLabel: 'Anniversary reward', fallbackPts: `Earn ${ptsAbbrev} every year` },
    { pattern: /email|verify|confirm/i, icon: '✉️', fallbackLabel: 'Verify your email', fallbackPts: `Earn ${ptsAbbrev} once verified` },
    { pattern: /profile|complete/i,     icon: '👤', fallbackLabel: 'Complete your profile', fallbackPts: `Earn ${ptsAbbrev} for completion` },
    { pattern: /review|feedback/i,      icon: '⭐', fallbackLabel: 'Write a review', fallbackPts: `Earn ${ptsAbbrev} per review` },
    { pattern: /social|follow|instagram|twitter/i, icon: '📲', fallbackLabel: 'Follow us on social', fallbackPts: `Earn ${ptsAbbrev} for following` },
  ];

  const matched = [];
  const used = new Set();

  for (const cat of profileCategories) {
    const rule = rules.find(r => !used.has(r.id) && cat.pattern.test(r.label || r.name || ''));
    if (rule) {
      used.add(rule.id);
      matched.push({
        icon: cat.icon,
        label: rule.label || rule.name || cat.fallbackLabel,
        pts: rule.pointValue || cat.fallbackPts,
      });
    } else if (matched.length < 4) {
      matched.push({ icon: cat.icon, label: cat.fallbackLabel, pts: cat.fallbackPts });
    }
  }

  // Return up to 4 perks
  return matched.slice(0, 4);
}

const LOCKED_LINKS = [
  { icon: '💼', label: 'My wallet',    desc: 'View your vouchers & codes' },
  { icon: '📋', label: 'History',      desc: 'See your points activity' },
  { icon: '🏆', label: 'Milestones',   desc: 'Track your milestone rewards' },
];

const GuestProfile = React.memo(function GuestProfile({ data, config, onGate }) {
  const earnRules = data.earnRules || data.merchant?.earnRules || [];
  const perks = useMemo(() => extractProfilePerks(earnRules, config), [earnRules, config]);

  return (
    <div style={{ padding: '20px 16px 24px', background: tokens.surface }}>

      {/* ─── Locked avatar ───────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: tokens.bg, border: `2px dashed ${tokens.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32, margin: '0 auto 12px',
          position: 'relative',
        }}>
          👤
          <div style={{
            position: 'absolute', bottom: -4, right: -4,
            width: 22, height: 22, borderRadius: '50%',
            background: tokens.textSubtle, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, border: '2px solid #fff',
          }}>
            🔒
          </div>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text, marginBottom: 4 }}>
          Your profile is locked
        </div>
        <div style={{ fontSize: 12, color: tokens.textMuted }}>
          Sign in to manage your rewards &amp; preferences
        </div>
      </div>

      {/* ─── Primary CTA ─────────────────────────────────────────────── */}
      <button
        onClick={() => onGate('sign in to view your profile')}
        style={{
          width: '100%', padding: 13,
          background: config.accentColor, color: '#fff',
          border: 'none', borderRadius: tokens.radiusLg,
          fontSize: 14, fontWeight: 700, cursor: 'pointer',
          marginBottom: 24,
        }}
      >
        Sign in to your account →
      </button>

      {/* ─── Profile completion perks ────────────────────────────────── */}
      {perks.length > 0 && (
        <>
          <div style={{
            fontSize: 11, fontWeight: 700, color: tokens.textMuted,
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
          }}>
            Earn by completing your profile
          </div>
          {perks.map((p, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', marginBottom: 8,
                background: tokens.bg, borderRadius: tokens.radiusMd,
                border: `1px solid ${tokens.borderSoft}`,
                opacity: 0.75,
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: accentSoft(config.accentColor),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, flexShrink: 0,
              }}>
                {p.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>
                  {p.label}
                </div>
                <div style={{ fontSize: 12, color: tokens.successText, fontWeight: 600, marginTop: 2 }}>
                  {p.pts}
                </div>
              </div>
              <span style={{ fontSize: 14, color: tokens.textSubtle }}>🔒</span>
            </div>
          ))}
        </>
      )}

      {/* ─── Locked quick-links ──────────────────────────────────────── */}
      <div style={{
        fontSize: 11, fontWeight: 700, color: tokens.textMuted,
        textTransform: 'uppercase', letterSpacing: 0.5,
        marginTop: 20, marginBottom: 10,
      }}>
        Member sections
      </div>
      {LOCKED_LINKS.map((link, i) => (
        <button
          key={i}
          onClick={() => onGate(`access your ${link.label.toLowerCase()}`)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', marginBottom: 8,
            background: tokens.surface,
            border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg,
            cursor: 'pointer', textAlign: 'left',
            opacity: 0.7,
          }}
        >
          <span style={{ fontSize: 20 }}>{link.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{link.label}</div>
            <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 1 }}>{link.desc}</div>
          </div>
          <span style={{ fontSize: 14, color: tokens.textSubtle }}>🔒</span>
        </button>
      ))}
    </div>
  );
});

export default GuestProfile;
