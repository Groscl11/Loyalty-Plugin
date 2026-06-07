/**
 * MemberHome — feed-style home for active members.
 *
 * Layout (top-to-bottom):
 *   1. Personalised greeting
 *   2. Tier card with progress bar to next tier
 *   3. Primary CTA card — "Next reward" (closest unlocked redeemable)
 *   4. Quick ways to earn (top 2 actions teaser)
 *   5. Recent activity (last 3 transactions)
 *
 * Replaces the previous QuickNav 6-tile grid which duplicated the bottom nav.
 */

import React, { useMemo } from 'react';
import { tokens, tierStyleByIndex, tierStyleFromColor, accentSoft, fmtPts, adjustColor } from '../../utils/tokens.js';
import { interpolate } from '../../utils/interpolate.js';

const MemberHome = React.memo(function MemberHome({
  data,
  config,
  setTab,
  openSurvey,
}) {
  const { customer, merchant, history, redeemCatalog, survey } = data;

  // Build a sorted tier list from merchant.tierThresholds (works for any tier names,
  // not just the generic bronze/silver/gold/platinum).
  const tierOrder = useMemo(() => {
    const thresholds = merchant.tierThresholds || {};
    return Object.entries(thresholds)
      .filter(([key]) => key !== 'names')
      .sort(([, a], [, b]) => (a || 0) - (b || 0))
      .map(([key]) => key);
  }, [merchant.tierThresholds]);

  // ── Tier progress ─────────────────────────────────────────────────────────
  // Fall back to the program's lowest configured tier (not a hardcoded "bronze"
  // that may not exist in this merchant's program).
  const currentTier = customer.tier || tierOrder[0] || '';

  const currentTierIdx = tierOrder.length ? Math.max(0, tierOrder.indexOf(currentTier)) : 0;
  const tierVis = (() => {
    const posBased    = tierStyleByIndex(currentTierIdx);
    const customColor = merchant.tierColors?.[currentTier];
    if (customColor) {
      // Merge admin color gradient with position-appropriate emoji
      return { ...tierStyleFromColor(customColor), emoji: posBased.emoji };
    }
    return posBased;
  })();
  const nextTierKey      = tierOrder[currentTierIdx + 1] || null;
  const nextThreshold    = nextTierKey ? (merchant.tierThresholds?.[nextTierKey] ?? null) : null;
  const currentThreshold = merchant.tierThresholds?.[currentTier] || 0;
  // Tier progress uses lifetime earned — spending points never resets your tier progress
  const lifetimePts      = customer.lifetimeEarned || 0;
  const ptsToNext        = nextThreshold != null ? Math.max(0, nextThreshold - lifetimePts) : 0;
  const progressPct      = nextThreshold
    ? Math.min(100, Math.max(0, Math.round(((lifetimePts - currentThreshold) / (nextThreshold - currentThreshold)) * 100)))
    : 100;

  // ── Next reward (closest redeemable the user is working toward) ──────────
  const nextReward = useMemo(() => {
    // Exclude brandRewards — those are cross-brand marketplace/partner vouchers.
    // Only feature store-specific discount and manual rewards as the "next goal".
    const all = [
      ...(redeemCatalog?.discountRewards || []),
      ...(redeemCatalog?.manualRewards   || []),
    ];
    if (!all.length) return null;
    const balance = customer.pointsBalance || 0;
    // Prefer the cheapest reward they CAN afford; else the cheapest one above balance.
    const affordable = all.filter(r => balance >= (r.pointsCost ?? 0));
    if (affordable.length) {
      return [...affordable].sort((a, b) => (b.pointsCost ?? 0) - (a.pointsCost ?? 0))[0];
    }
    return [...all].sort((a, b) => (a.pointsCost ?? 0) - (b.pointsCost ?? 0))[0];
  }, [redeemCatalog, customer.pointsBalance]);

  const nextRewardProgress = nextReward
    ? Math.min(100, Math.round(((customer.pointsBalance || 0) / (nextReward.pointsCost || 1)) * 100))
    : 0;
  const canRedeemNext = nextReward && (customer.pointsBalance || 0) >= (nextReward.pointsCost || 0);
  const nextRewardGap = nextReward ? Math.max(0, (nextReward.pointsCost || 0) - (customer.pointsBalance || 0)) : 0;

  // ── Greeting ─────────────────────────────────────────────────────────────
  const greeting = interpolate(config.welcomeMsg || 'Hi {firstName} 👋', {
    firstName: customer.firstName || 'there',
  });

  // ── Recent activity ──────────────────────────────────────────────────────
  const recent = (history || []).slice(0, 3);

  // ── Top earn actions (teaser for home) ───────────────────────────────────
  const earnRules = merchant.earnRules || [];
  const topEarn = earnRules.find(r => r.featured) || earnRules[0];
  const referEarn = earnRules.find(r => r.id === 'er3' || /refer/i.test(r.label));

  return (
    <div style={{ padding: '16px 16px 24px', background: tokens.surface }}>

      {/* ─── Greeting ────────────────────────────────────────────────── */}
      <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 16, color: tokens.text }}>
        {greeting}
      </div>

      {/* ─── Tier card with progress ─────────────────────────────────── */}
      <div
        style={{
          background: tierVis.bg,
          borderRadius: tokens.radiusLg,
          padding: 16,
          marginBottom: 12,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative bubble */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -30, right: -30,
            width: 100, height: 100,
            background: 'rgba(255,255,255,0.4)',
            borderRadius: '50%',
          }}
        />
        <div style={{
          fontSize: 11, fontWeight: 700, color: tierVis.accent,
          textTransform: 'uppercase', letterSpacing: 0.5,
          marginBottom: 4, position: 'relative',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 14 }}>{tierVis.emoji}</span>
          {customer.tierName || config.tierNames?.[currentTier] || currentTier} tier
        </div>
        <div style={{
          fontSize: 30, fontWeight: 700,
          color: tierVis.text, letterSpacing: -0.5,
          marginBottom: 12, position: 'relative',
        }}>
          {fmtPts(customer.pointsBalance)} {config.pointsAbbrev || 'pts'}
        </div>
        {nextThreshold != null && nextThreshold > 0 && (
          <>
            <div style={{
              height: 8, background: 'rgba(255,255,255,0.5)',
              borderRadius: 4, overflow: 'hidden',
              marginBottom: 6, position: 'relative',
            }}>
              <div style={{
                width: `${progressPct}%`, height: '100%',
                background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
                borderRadius: 4, transition: 'width 0.5s ease',
              }} />
            </div>
            <div style={{ fontSize: 12, color: tierVis.text, fontWeight: 500, position: 'relative' }}>
              {fmtPts(ptsToNext)} {config.pointsAbbrev || 'pts'} to{' '}
              <strong style={{ fontWeight: 700 }}>
                {config.tierNames?.[nextTierKey] || nextTierKey} →
              </strong>
            </div>
            <div style={{ fontSize: 10, color: tierVis.text, opacity: 0.75, marginTop: 2, position: 'relative' }}>
              {fmtPts(lifetimePts)} earned so far · spending points doesn't reset your tier
            </div>
          </>
        )}
      </div>

      {/* ─── Primary CTA: Next reward ────────────────────────────────── */}
      {nextReward && (
        <button
          onClick={() => setTab('redeem')}
          style={{
            width: '100%',
            background: accentSoft(config.accentColor),
            border: `1px solid ${config.accentColor}`,
            borderRadius: tokens.radiusLg,
            padding: 14,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 24, width: 32, textAlign: 'center', flexShrink: 0 }}>
            🚚
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11, color: tokens.textMuted, marginBottom: 2,
              textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600,
            }}>
              {canRedeemNext ? 'Ready to redeem' : 'Next reward'}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: tokens.text }}>
              {nextReward.title}
            </div>
            <div style={{
              height: 4, background: tokens.border, borderRadius: 2,
              overflow: 'hidden', marginBottom: 4,
            }}>
              <div style={{
                width: `${nextRewardProgress}%`, height: '100%',
                background: config.accentColor,
              }} />
            </div>
            <div style={{ fontSize: 11, color: tokens.textMuted }}>
              {canRedeemNext
                ? `Costs ${fmtPts(nextReward.pointsCost)} ${config.pointsAbbrev || 'pts'}`
                : `${fmtPts(nextRewardGap)} ${config.pointsAbbrev || 'pts'} to unlock`}
            </div>
          </div>
          <div style={{
            background: config.accentColor, color: '#fff',
            padding: '8px 14px', borderRadius: tokens.radiusMd,
            fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {canRedeemNext ? 'Redeem →' : 'View'}
          </div>
        </button>
      )}

      {/* ─── Quick ways to earn ──────────────────────────────────────── */}
      {(topEarn || referEarn) && (
        <>
          <SectionHeader title="Quick ways to earn" />
          {topEarn && (
            <EarnRow
              rule={topEarn}
              accentColor={config.accentColor}
              onClick={() => {
                if (/survey/i.test(topEarn.label) && openSurvey) openSurvey();
                else setTab('earn');
              }}
            />
          )}
          {referEarn && referEarn.id !== topEarn?.id && (
            <EarnRow
              rule={referEarn}
              accentColor={config.accentColor}
              onClick={() => setTab('refer')}
            />
          )}
          <button
            onClick={() => setTab('earn')}
            style={{
              width: '100%', textAlign: 'center',
              border: 'none', background: 'transparent',
              color: config.accentColor, fontSize: 13, fontWeight: 500,
              padding: '8px 0 4px', cursor: 'pointer', marginTop: 4,
            }}
          >
            See all ways to earn →
          </button>
        </>
      )}

      {/* ─── Recent activity ─────────────────────────────────────────── */}
      <SectionHeader title="Recent activity" marginTop={20} />
      {recent.length > 0 ? (
        <>
          {recent.map(tx => <ActivityRow key={tx.id} tx={tx} pointsAbbrev={config.pointsAbbrev} />)}
          <button
            onClick={() => setTab('history')}
            style={{
              width: '100%', textAlign: 'center',
              border: 'none', background: 'transparent',
              color: config.accentColor, fontSize: 13, fontWeight: 500,
              padding: '8px 0 0', cursor: 'pointer',
            }}
          >
            See all transactions →
          </button>
        </>
      ) : (
        <div style={{
          textAlign: 'center', padding: '20px 0',
          color: tokens.textMuted, fontSize: 13,
          border: `1px dashed ${tokens.border}`,
          borderRadius: tokens.radiusMd,
        }}>
          No activity yet — earn your first points above ↑
        </div>
      )}
    </div>
  );
});

function SectionHeader({ title, marginTop = 16 }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: tokens.textMuted,
      marginTop, marginBottom: 8,
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      {title}
    </div>
  );
}

function EarnRow({ rule, accentColor, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radiusLg,
        padding: 12, marginBottom: 8,
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: accentSoft(accentColor),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, flexShrink: 0,
      }}>
        {rule.icon || '✨'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>
          {rule.label}
        </div>
        <div style={{ fontSize: 12, color: tokens.successText, fontWeight: 600, marginTop: 2 }}>
          {rule.pointValue} {rule.featured && ' · POPULAR'}
        </div>
      </div>
      <span style={{ color: tokens.textSubtle, fontSize: 18 }}>›</span>
    </button>
  );
}

function ActivityRow({ tx, pointsAbbrev }) {
  const isEarn = tx.type === 'earn' || (tx.delta ?? 0) > 0;
  const delta = tx.delta ?? 0;
  const sign = delta > 0 ? '+' : '';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: `1px solid ${tokens.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span style={{
          color: isEarn ? tokens.successText : tokens.danger,
          fontWeight: 700, fontSize: 13,
          background: isEarn ? tokens.successSoft : tokens.dangerSoft,
          padding: '2px 8px', borderRadius: 999,
          minWidth: 48, textAlign: 'center', flexShrink: 0,
        }}>
          {sign}{fmtPts(Math.abs(delta))}
        </span>
        <span style={{
          fontSize: 13, color: tokens.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {tx.description || tx.label || (isEarn ? 'Points earned' : 'Points redeemed')}
        </span>
      </div>
      <span style={{ fontSize: 11, color: tokens.textMuted, flexShrink: 0, marginLeft: 8 }}>
        {formatRelativeDate(tx.created_at || tx.date)}
      </span>
    </div>
  );
}

function formatRelativeDate(d) {
  if (!d) return '';
  try {
    const date = new Date(d);
    const diffMs = Date.now() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 1)   return 'today';
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7)   return `${diffDays} days ago`;
    if (diffDays < 14)  return '1 week ago';
    if (diffDays < 30)  return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

export default MemberHome;
