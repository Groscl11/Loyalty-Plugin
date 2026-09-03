/**
 * GuestRefer — referral program teaser for guests.
 * Shows how-it-works steps, bonus teaser, and optional leaderboard preview.
 * All CTAs redirect to /account/login via onGate.
 */

import React from 'react';
import { tokens, accentSoft, fmtPts, adjustColor } from '../../utils/tokens.js';

const HOW_IT_WORKS = [
  { step: '1', icon: '🔗', title: 'Get your link',     body: 'Sign in to receive your unique referral link' },
  { step: '2', icon: '📤', title: 'Share with friends', body: 'Send your link via WhatsApp, email, or social' },
  { step: '3', icon: '🎁', title: 'Both of you earn',  body: 'You and your friend both earn bonus points' },
];

const GuestRefer = React.memo(function GuestRefer({ data, config, onGate }) {
  if (!config.showReferTab) return null;

  const leaderboard = data.leaderboard || [];

  // Try to surface referral bonus from earn rules
  const referRule = (data.earnRules || []).find(r => /refer/i.test(r.label || r.name || ''));
  const referBonus = referRule?.pointValue || null;

  return (
    <div style={{ padding: '20px 16px 24px', background: tokens.surface }}>

      {/* ─── Hero ────────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>📣</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: tokens.text, marginBottom: 6 }}>
          Refer friends, earn together
        </div>
        {referBonus ? (
          <div style={{
            display: 'inline-block',
            background: tokens.successSoft, color: tokens.successText,
            borderRadius: 999, padding: '4px 14px',
            fontSize: 13, fontWeight: 700,
          }}>
            {referBonus} for every friend who signs up
          </div>
        ) : (
          <div style={{ fontSize: 13, color: tokens.textMuted }}>
            Earn bonus {config.pointsNoun || 'points'} for every successful referral
          </div>
        )}
      </div>

      {/* ─── How it works ────────────────────────────────────────────── */}
      <div style={{
        fontSize: 11, fontWeight: 700, color: tokens.textMuted,
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
      }}>
        How it works
      </div>
      <div style={{ marginBottom: 20 }}>
        {HOW_IT_WORKS.map((s, idx) => (
          <div key={s.step} style={{
            display: 'flex', gap: 12, alignItems: 'flex-start',
            paddingBottom: idx < HOW_IT_WORKS.length - 1 ? 12 : 0,
            marginBottom: idx < HOW_IT_WORKS.length - 1 ? 0 : 0,
            position: 'relative',
          }}>
            {/* Connector line */}
            {idx < HOW_IT_WORKS.length - 1 && (
              <div style={{
                position: 'absolute', left: 16, top: 36, bottom: -12,
                width: 2, background: tokens.borderSoft,
              }} />
            )}
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: accentSoft(config.accentColor),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0, zIndex: 1,
            }}>
              {s.icon}
            </div>
            <div style={{ paddingTop: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 2 }}>
                {s.title}
              </div>
              <div style={{ fontSize: 12, color: tokens.textMuted }}>
                {s.body}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Primary CTA ─────────────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${config.accentColor}, ${adjustColor(config.accentColor, -30)})`,
        color: '#fff', borderRadius: tokens.radiusLg,
        padding: 16, marginBottom: 20,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, opacity: 0.9 }}>
          Sign in to get your unique referral link
        </div>
        <button
          onClick={() => onGate('get your referral link')}
          style={{
            width: '100%', padding: 12,
            background: '#fff', color: config.accentColor,
            border: 'none', borderRadius: tokens.radiusMd,
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Get my referral link →
        </button>
      </div>

      {/* ─── Monthly prizes (if configured) ─────────────────────────── */}
      {config.prizes && config.prizes.length > 0 && config.prizes.some(p => p.prize || p.desc) && (
        <div style={{
          background: tokens.warningSoft, border: `1px solid #fde68a`,
          borderRadius: tokens.radiusLg, padding: 14, marginBottom: 20,
        }}>
          <div style={{
            fontWeight: 700, fontSize: 11, color: tokens.warningText,
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
          }}>
            🎖️ Monthly prizes
          </div>
          {config.prizes.map((p, i) => (
            <div key={i} style={{
              display: 'flex', gap: 10, fontSize: 13,
              marginBottom: i < config.prizes.length - 1 ? 8 : 0,
            }}>
              <span style={{ fontWeight: 600, color: tokens.warningText, minWidth: 44 }}>
                {p.rank}
              </span>
              <span style={{ color: tokens.text }}>— {p.prize || p.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* ─── Leaderboard preview ─────────────────────────────────────── */}
      {config.showLeaderboard && leaderboard.length > 0 && (
        <>
          <div style={{
            fontSize: 11, fontWeight: 700, color: tokens.textMuted,
            marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            Monthly leaderboard
          </div>
          {leaderboard.slice(0, 3).map(row => (
            <div key={row.rank} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', marginBottom: 6,
              background: tokens.surface, border: `1px solid ${tokens.border}`,
              borderRadius: tokens.radiusMd,
            }}>
              <span style={{ fontWeight: 700, fontSize: 14, minWidth: 28, textAlign: 'center', color: tokens.text }}>
                {row.rank <= 3 ? ['🥇','🥈','🥉'][row.rank - 1] : `#${row.rank}`}
              </span>
              <span style={{ flex: 1, fontWeight: 500, fontSize: 13, color: tokens.text }}>
                {row.name}
              </span>
              <span style={{ fontSize: 12, color: tokens.textMuted }}>
                {row.referralCount} refs
              </span>
              <span style={{ fontWeight: 700, fontSize: 13, color: tokens.successText }}>
                +{fmtPts(row.ptsEarned)}
              </span>
            </div>
          ))}
          {/* Guest placeholder */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', marginTop: 8,
            background: tokens.bg, borderRadius: tokens.radiusMd,
            fontSize: 12, color: tokens.textMuted,
          }}>
            <span style={{ fontWeight: 700, minWidth: 28, textAlign: 'center' }}>?</span>
            <span style={{ flex: 1 }}>
              Your spot is open — sign in to start climbing
            </span>
          </div>
        </>
      )}
    </div>
  );
});

export default GuestRefer;
