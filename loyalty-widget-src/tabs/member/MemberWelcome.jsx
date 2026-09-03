/**
 * MemberWelcome — onboarding home for newly-enrolled members.
 *
 * Triggered when (lifetimeEarned === 0 OR !welcomeBonusClaimed). Shows:
 *   1. 🎉 Welcome hero
 *   2. Welcome bonus claim card (one-tap)
 *   3. Bronze tier card (0 pts, 0% progress)
 *   4. Quick wins — 3 highest-value earn actions
 *
 * Once the user claims the bonus OR earns their first points, this screen
 * goes away (LoyaltyWidget falls back to MemberHome).
 *
 * Decision log:
 * - We DON'T auto-credit welcome points. Requires explicit user action so
 *   the bonus feels earned and we record consent.
 * - Claim button calls claim-welcome-bonus edge fn; on success refetches
 *   customer_session and the screen auto-swaps to MemberHome.
 */

import React, { useState, useCallback } from 'react';
import { tokens, accentSoft, fmtPts } from '../../utils/tokens.js';
import { SUPABASE_URL, SUPABASE_HEADERS } from '../../utils/supabase.js';

const WELCOME_BONUS_PTS = 100;

const MemberWelcome = React.memo(function MemberWelcome({ data, config, setTab, openSurvey }) {
  const { customer, merchant } = data;
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState(null);

  const earnRules = merchant.earnRules || [];
  // Pick the 3 highest-value one-time / repeatable earn actions for quick wins
  const quickWins = earnRules.slice(0, 3);

  const handleClaim = useCallback(async () => {
    if (claiming) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/claim-welcome-bonus`, {
        method: 'POST',
        headers: SUPABASE_HEADERS,
        body: JSON.stringify({
          member_user_id: customer.customerId || null,
          email:          customer.email || null,
          shop_domain:    (typeof window !== 'undefined' && window.Shopify?.shop) || window.location?.hostname || '',
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setClaimError(json.error || 'Could not claim your welcome bonus. Try again.');
        return;
      }
      data.refetch('customer_session');
    } catch (e) {
      setClaimError('Network error. Check your connection and try again.');
    } finally {
      setClaiming(false);
    }
  }, [claiming, customer, data]);

  return (
    <div style={{ padding: '24px 16px', background: tokens.surface }}>

      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          display: 'inline-block',
          fontSize: 56,
          width: 96, height: 96, lineHeight: '96px',
          background: 'linear-gradient(135deg, #fef3c7, #fcd9b6)',
          borderRadius: '50%',
          marginBottom: 8,
        }}>
          🎉
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: tokens.text, marginBottom: 4 }}>
          Welcome, {customer.firstName || 'friend'}!
        </div>
        <div style={{ fontSize: 13, color: tokens.textMuted, lineHeight: 1.5 }}>
          You're now a {merchant.storeName || 'rewards'} member.
        </div>
      </div>

      {/* Welcome bonus card */}
      {!customer.welcomeBonusClaimed && (
        <div
          style={{
            background: 'linear-gradient(135deg, #fef3c7, #fef9c3)',
            border: `1px solid ${tokens.warning}`,
            borderRadius: tokens.radiusLg,
            padding: 14,
            marginBottom: 16,
            display: 'flex', alignItems: 'center', gap: 12,
          }}
        >
          <div style={{ fontSize: 30 }}>🎁</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: tokens.warningText }}>
              Welcome bonus
            </div>
            <div style={{ fontSize: 11, color: tokens.warningText, marginTop: 2, opacity: 0.85 }}>
              Claim {WELCOME_BONUS_PTS} free {config.pointsNoun || 'points'} to get started
            </div>
          </div>
          <button
            onClick={handleClaim}
            disabled={claiming}
            style={{
              background: tokens.warning, color: '#fff', border: 'none',
              padding: '8px 14px', borderRadius: tokens.radiusMd,
              fontSize: 13, fontWeight: 700,
              cursor: claiming ? 'wait' : 'pointer', whiteSpace: 'nowrap',
              opacity: claiming ? 0.7 : 1,
            }}
          >
            {claiming ? '…' : 'Claim'}
          </button>
        </div>
      )}

      {claimError && (
        <div style={{
          background: tokens.dangerSoft, border: `1px solid #fecaca`,
          borderRadius: tokens.radiusMd, padding: '8px 12px',
          fontSize: 12, color: '#dc2626', marginBottom: 16,
        }}>
          ⚠ {claimError}
        </div>
      )}

      {/* Empty tier card (Bronze, 0 pts) */}
      <div
        style={{
          background: 'linear-gradient(135deg, #fef3c7, #fcd9b6)',
          borderRadius: tokens.radiusLg, padding: 16, marginBottom: 16,
          position: 'relative', overflow: 'hidden',
        }}
      >
        <div aria-hidden="true" style={{
          position: 'absolute', top: -30, right: -30,
          width: 100, height: 100, background: 'rgba(255,255,255,0.4)', borderRadius: '50%',
        }} />
        <div style={{
          fontSize: 11, fontWeight: 700, color: '#92400e',
          textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
          display: 'flex', alignItems: 'center', gap: 6, position: 'relative',
        }}>
          🥉 {config.tierNames?.bronze || 'Bronze'} tier · just joined
        </div>
        <div style={{
          fontSize: 30, fontWeight: 700, color: '#78350f',
          letterSpacing: -0.5, marginBottom: 12, position: 'relative',
        }}>
          {fmtPts(customer.pointsBalance)} {config.pointsAbbrev || 'pts'}
        </div>
        <div style={{
          height: 8, background: 'rgba(255,255,255,0.5)',
          borderRadius: 4, marginBottom: 6, position: 'relative',
        }}>
          <div style={{
            width: `${Math.min(100, Math.round(((customer.pointsBalance || 0) / Math.max(merchant.tierThresholds?.silver || 10000, 1)) * 100))}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
            borderRadius: 4,
          }} />
        </div>
        <div style={{ fontSize: 12, color: '#78350f', fontWeight: 500, position: 'relative' }}>
          Earn {fmtPts(merchant.tierThresholds?.silver || 10000)} {config.pointsAbbrev || 'pts'} to reach{' '}
          <strong style={{ fontWeight: 700 }}>
            {config.tierNames?.silver || 'Silver'} →
          </strong>
        </div>
      </div>

      {/* Quick wins */}
      {quickWins.length > 0 && (
        <>
          <div style={{
            fontSize: 11, fontWeight: 700, color: tokens.textMuted,
            marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            Quick wins
          </div>
          {quickWins.map(rule => (
            <button
              key={rule.id}
              onClick={() => {
                if (/survey/i.test(rule.label) && openSurvey) openSurvey();
                else if (/refer/i.test(rule.label)) setTab('refer');
                else setTab('earn');
              }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                background: tokens.surface, border: `1px solid ${tokens.border}`,
                borderRadius: tokens.radiusLg, padding: 12, marginBottom: 8,
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: accentSoft(config.accentColor),
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
                  {rule.pointValue}
                </div>
              </div>
              <span style={{ color: tokens.textSubtle, fontSize: 18 }}>›</span>
            </button>
          ))}
          <button
            onClick={() => setTab('earn')}
            style={{
              width: '100%', textAlign: 'center', border: 'none',
              background: 'transparent', color: config.accentColor,
              fontSize: 13, fontWeight: 500, padding: '8px 0 0', cursor: 'pointer',
            }}
          >
            See all ways to earn →
          </button>
        </>
      )}

      {/* Empty activity */}
      <div style={{
        marginTop: 20, padding: '20px 16px',
        textAlign: 'center', color: tokens.textMuted, fontSize: 13,
        border: `1px dashed ${tokens.border}`, borderRadius: tokens.radiusMd,
      }}>
        No activity yet — earn your first points above ↑
      </div>
    </div>
  );
});

export default MemberWelcome;
