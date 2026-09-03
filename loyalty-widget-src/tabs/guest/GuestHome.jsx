/**
 * GuestHome — value-prop screen for unauthenticated visitors.
 *
 * Layout (top-to-bottom):
 *   1. Brand hero (store name + tagline)
 *   2. Tier progression strip (from real API data)
 *   3. Primary CTA — "Sign in or create account"
 *   4. Benefits list from real earn rules
 *   5. Secondary footer: "Already a member? Sign in →"
 */

import React, { useMemo } from 'react';
import { tokens, accentSoft, adjustColor, tierStyleByIndex, tierStyleFromColor } from '../../utils/tokens.js';

const GuestHome = React.memo(function GuestHome({ data, config, onGate }) {
  const { merchant } = data;
  const earnRules = (data.earnRules || merchant?.earnRules || []);

  // ── Build ordered tier list from real API data ─────────────────────────────
  const tierOrder = useMemo(() => {
    const thresholds = merchant?.tierThresholds || {};
    return Object.entries(thresholds)
      .sort(([, a], [, b]) => (a || 0) - (b || 0))
      .map(([key]) => key);
  }, [merchant?.tierThresholds]);

  // ── Benefits list — use real earn rules, fall back to generic ──────────────
  const purchaseRule = earnRules.find(r => /purchase|order|spend/i.test(r.label || r.name || ''))
    || earnRules[0];
  const referRule  = earnRules.find(r => /refer/i.test(r.label || r.name || ''));
  const surveyRule = earnRules.find(r => /survey|review/i.test(r.label || r.name || ''));

  const benefits = [
    {
      icon: '🛒',
      title: 'Earn on every purchase',
      body: purchaseRule?.pointValue || `Earn ${config.pointsNoun || 'points'} automatically on every order`,
    },
    tierOrder.length > 1 && {
      icon: tierOrder.length >= 4 ? '💎' : tierOrder.length >= 3 ? '🥇' : '🥈',
      title: 'Unlock tier benefits as you earn',
      body: tierOrder.map(k => {
        const name = config.tierNames?.[k] || k.charAt(0).toUpperCase() + k.slice(1);
        return name;
      }).join(' → '),
    },
    referRule && {
      icon: '📣',
      title: referRule.label || referRule.name || 'Refer friends, earn together',
      body: referRule.pointValue || 'Both you and your friend get rewarded',
    },
    {
      icon: '🎁',
      title: 'Redeem for discounts & rewards',
      body: `Use your ${config.pointsNoun || 'points'} for store discounts and exclusive perks`,
    },
  ].filter(Boolean).slice(0, 4);

  return (
    <div style={{ padding: '20px 16px 24px', background: tokens.surface }}>

      {/* ─── Brand hero ───────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 44, width: 80, height: 80,
          background: `linear-gradient(135deg, ${accentSoft(config.accentColor)}, #fae8ff)`,
          borderRadius: '50%', marginBottom: 10,
        }}>
          🎁
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: tokens.text, marginBottom: 4 }}>
          {merchant?.storeName || 'Rewards Program'}
        </div>
        <div style={{ fontSize: 13, color: tokens.textMuted, lineHeight: 1.5, padding: '0 8px' }}>
          {config.guestHeadline || `Earn ${config.pointsNoun || 'points'} on every order, redeem for exclusive perks.`}
        </div>
      </div>

      {/* ─── Tier progression strip ───────────────────────────────────── */}
      {tierOrder.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: tokens.textMuted,
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
          }}>
            Tier journey
          </div>
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
            {tierOrder.map((tierKey, idx) => {
              // Always prefer custom color from dashboard; fall back to position-based
              const customColor = merchant?.tierColors?.[tierKey];
              const vis = customColor
                ? { ...tierStyleFromColor(customColor), emoji: tierStyleByIndex(idx).emoji }
                : tierStyleByIndex(idx);
              const displayName = config.tierNames?.[tierKey]
                || (tierKey.charAt(0).toUpperCase() + tierKey.slice(1));
              const threshold = merchant?.tierThresholds?.[tierKey] ?? 0;
              return (
                <React.Fragment key={tierKey}>
                  {/* Separator arrow */}
                  {idx > 0 && (
                    <div style={{
                      alignSelf: 'center', color: tokens.textSubtle,
                      fontSize: 11, flexShrink: 0, lineHeight: 1,
                    }}>›</div>
                  )}
                  {/* Equal-width tier card — flexBasis:0 forces true equal split */}
                  <div style={{
                    flex: '1 1 0', minWidth: 0,
                    background: vis.bg,
                    borderRadius: tokens.radiusMd,
                    padding: '10px 4px 8px',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 18, marginBottom: 3, lineHeight: 1 }}>{vis.emoji}</div>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: vis.text,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      padding: '0 2px',
                    }}>
                      {displayName}
                    </div>
                    <div style={{
                      fontSize: 9, color: vis.accent, marginTop: 2, fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}>
                      {threshold > 0 ? `${threshold.toLocaleString()} pts` : 'Start here'}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Primary CTA card ────────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${config.accentColor}, ${adjustColor(config.accentColor, -30)})`,
        color: '#fff', borderRadius: tokens.radiusLg,
        padding: 16, marginBottom: 20,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, opacity: 0.95 }}>
          Sign in to start earning & redeeming
        </div>
        <button
          onClick={() => onGate('sign in')}
          style={{
            width: '100%', padding: 12,
            background: '#fff', color: config.accentColor,
            border: 'none', borderRadius: tokens.radiusMd,
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Sign in or create account →
        </button>
      </div>

      {/* ─── Benefits list ───────────────────────────────────────────── */}
      <div style={{
        fontSize: 11, fontWeight: 700, color: tokens.textMuted,
        marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        What you get
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {benefits.map((b, i) => (
          <li key={i} style={{
            display: 'flex', gap: 12, alignItems: 'flex-start',
            padding: '8px 0',
            borderBottom: i < benefits.length - 1 ? `1px solid ${tokens.borderSoft}` : 'none',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: tokens.bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0, marginTop: 2,
            }}>
              {b.icon}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.4 }}>
              <strong style={{ display: 'block', fontSize: 13, marginBottom: 2, color: tokens.text }}>
                {b.title}
              </strong>
              <span style={{ color: tokens.textMuted, fontSize: 12 }}>{b.body}</span>
            </div>
          </li>
        ))}
      </ul>

      {/* ─── Secondary CTA ───────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: tokens.textMuted }}>
        Already a member?{' '}
        <button
          onClick={() => onGate('sign in')}
          style={{
            background: 'none', border: 'none',
            color: config.accentColor, fontWeight: 600,
            cursor: 'pointer', fontSize: 12, padding: 0,
          }}
        >
          Sign in →
        </button>
      </div>
    </div>
  );
});

export default GuestHome;
