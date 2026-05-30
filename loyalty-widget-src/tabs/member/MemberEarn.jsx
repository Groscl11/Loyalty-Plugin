/**
 * MemberEarn — GoSelf Loyalty Widget V6
 * Fetches earn rules from backend (get-earning-rules).
 * Shows available actions at top with CTAs; claimed rules below.
 */

import React, { useCallback } from 'react';
import { tokens, accentSoft, fmtPts } from '../../utils/tokens.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../utils/supabase.js';

// ── Helper: Claim action/survey reward ────────────────────────────────────────
async function handleSocialActionClaim(rule, shopDomain, onClaimSuccess) {
  try {
    // Get customer email from multiple sources
    const email = (
      (typeof window !== 'undefined' && window.__goself_customer_email) ||
      (window?.Shopify?.customerEmail) ||
      (window?.Shopify?.customer?.email) ||
      localStorage?.getItem?.('goself_customer_email') ||
      null
    );

    if (!email) {
      console.warn('[submit-action-reward] No customer email found');
      alert('🔐 Please log in to claim this reward');
      return;
    }

    // Call the UNIFIED backend function (submit-action-reward)
    console.log('[submit-action-reward] Claiming for:', email, 'rule:', rule.id);

    const response = await fetch(`${SUPABASE_URL}/functions/v1/submit-action-reward`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        shop_domain: shopDomain,
        rule_id: rule.id,
        rule_type: rule.rule_type,
        social_platform: rule.social_platform,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.warn('[submit-action-reward] Claim failed:', data.error);
      if (data.already_claimed) {
        console.log('[submit-action-reward] Already claimed by member');
      }
      return;
    }

    console.log('[submit-action-reward] ✅ Success! Points awarded:', data.points_awarded);

    // Open the social media link in a new window (for social/review rules)
    if (rule.rule_type === 'social' || rule.rule_type === 'review') {
      const url = rule.social_url || buildPlatformUrl(rule.social_platform || rule.name || '');
      if (url) {
        window.open(url, '_blank', 'noopener');
      }
    }

    // Trigger success callback to refetch data
    onClaimSuccess?.();
  } catch (err) {
    console.error('[submit-action-reward] Unexpected error:', err);
  }
}

// ── Icon resolver ─────────────────────────────────────────────────────────────
function getRuleIcon(rule) {
  if (rule.icon) return rule.icon; // legacy mock format
  const t = rule.rule_type || '';
  if (t === 'social') {
    const p = (rule.social_platform || '').toLowerCase();
    if (p.includes('instagram')) return '📸';
    if (p.includes('youtube'))   return '▶️';
    if (p.includes('tiktok'))    return '🎵';
    if (p.includes('twitter') || p.includes(' x')) return '🐦';
    if (p.includes('facebook'))  return '📘';
    return '📲';
  }
  const icons = {
    order: '🛍️', referral: '👥', birthday: '🎂',
    anniversary: '💝', review: '⭐', survey: '📋',
    profile_complete: '👤', signup: '🎉', custom: '🌟',
  };
  return icons[t] || '🌟';
}

function getPointLabel(rule) {
  if (rule.pointValue) return rule.pointValue; // legacy mock
  if (rule.rule_type === 'order') return '1 pt per ₹1 spent';
  if (rule.points_reward > 0) return `+${Number(rule.points_reward).toLocaleString('en-IN')} pts`;
  return '';
}

function inferRuleType(rule) {
  // Normalize raw DB rule_type variants to canonical widget types
  const raw = (rule.rule_type || '').toLowerCase();
  if (raw) {
    if (raw === 'order' || raw === 'purchase' || raw === 'transaction' || raw === 'spend') return 'order';
    if (raw.includes('refer'))                                                            return 'referral';
    if (raw === 'birthday')                                                               return 'birthday';
    if (raw === 'anniversary')                                                            return 'anniversary';
    if (raw.includes('review') || raw.includes('testimonial'))                           return 'review';
    if (raw.includes('survey') || raw.includes('quiz'))                                  return 'survey';
    if (raw.includes('profile') || raw === 'profile_complete' || raw === 'complete_profile') return 'profile_complete';
    if (raw.includes('signup')  || raw.includes('register') ||
        raw.includes('welcome') || raw === 'join')                                       return 'signup';
    if (raw.includes('social')  || raw.includes('follow')   ||
        raw.includes('instagram') || raw.includes('twitter') ||
        raw.includes('youtube')   || raw.includes('tiktok')  ||
        raw.includes('facebook')  || raw.includes('linkedin'))                           return 'social';
    // Unknown type — return as-is so ctaLabel falls through to 'Earn'
    return raw;
  }
  // No rule_type: infer from name
  const l = (rule.name || rule.label || '').toLowerCase();
  if (l.includes('order') || l.includes('shop') || l.includes('purchas')) return 'order';
  if (l.includes('refer'))                                                  return 'referral';
  if (l.includes('survey'))                                                 return 'survey';
  if (l.includes('review'))                                                 return 'review';
  if (l.includes('profile') || l.includes('complete'))                     return 'profile_complete';
  if (l.includes('instagram') || l.includes('follow') || l.includes('social')) return 'social';
  if (l.includes('birthday'))                                               return 'birthday';
  if (l.includes('anniversary'))                                            return 'anniversary';
  if (l.includes('welcome') || l.includes('signup') || l.includes('join')) return 'signup';
  return 'custom';
}

// ── Main component ────────────────────────────────────────────────────────────
const MemberEarn = React.memo(function MemberEarn({ data, config, setTab, openSurvey }) {
  const rawRules  = data.earnRules || data.merchant?.earnRules || [];
  const isLoading = data.isLoading && rawRules.length === 0;

  if (isLoading) {
    return (
      <div style={{ padding: '16px' }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{
            height: 68, borderRadius: 12, background: '#f3f4f6', marginBottom: 8,
            animation: 'goselfPulse 1.4s ease infinite', animationDelay: `${i * 0.1}s`,
          }} />
        ))}
        <style>{`@keyframes goselfPulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
      </div>
    );
  }

  if (rawRules.length === 0) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: tokens.textMuted }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🌟</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 6 }}>Earn rules coming soon</div>
        <div style={{ fontSize: 12 }}>Your merchant hasn&apos;t set up earning rules yet. Check back shortly.</div>
      </div>
    );
  }

  const available = rawRules.filter(r => !r.is_completed);
  const claimed   = rawRules.filter(r =>  r.is_completed);
  const totalAvailable = available.reduce((sum, r) => sum + (r.points_reward || 0), 0);

  return (
    <div style={{ padding: '16px 16px 24px', overflowY: 'auto', height: '100%', boxSizing: 'border-box', background: tokens.surface }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>
          Ways to earn
        </div>
        <div style={{ fontSize: 13, color: tokens.textMuted }}>
          {available.length} action{available.length !== 1 ? 's' : ''} available
          {totalAvailable > 0 && (
            <> · earn up to <strong style={{ color: tokens.text }}>{fmtPts(totalAvailable)} {config.pointsAbbrev || 'pts'}</strong></>
          )}
        </div>
      </div>

      {/* Available actions */}
      {available.map(rule => (
        <EarnRuleCard
          key={rule.id}
          rule={rule}
          config={config}
          setTab={setTab}
          openSurvey={openSurvey}
          isClaimed={false}
          onClaimSuccess={() => data.refetch('earn_rules')}
        />
      ))}

      {/* Claimed section */}
      {claimed.length > 0 && (
        <>
          <div style={{
            fontSize: 11, fontWeight: 700, color: tokens.textMuted,
            textTransform: 'uppercase', letterSpacing: 0.5,
            margin: '20px 0 8px',
          }}>
            Claimed
          </div>
          {claimed.map(rule => (
            <EarnRuleCard
              key={rule.id}
              rule={rule}
              config={config}
              setTab={setTab}
              openSurvey={openSurvey}
              isClaimed={true}
              onClaimSuccess={() => data.refetch('earn_rules')}
            />
          ))}
        </>
      )}
    </div>
  );
});

// ── Platform URL helper ───────────────────────────────────────────────────────
function buildPlatformUrl(nameOrPlatform) {
  const s = (nameOrPlatform || '').toLowerCase();
  if (s.includes('instagram'))  return 'https://www.instagram.com';
  if (s.includes('youtube'))    return 'https://www.youtube.com';
  if (s.includes('twitter') || s.includes(' x')) return 'https://twitter.com';
  if (s.includes('tiktok'))     return 'https://www.tiktok.com';
  if (s.includes('facebook'))   return 'https://www.facebook.com';
  if (s.includes('linkedin'))   return 'https://www.linkedin.com';
  return null;
}

// ── Rule Card ─────────────────────────────────────────────────────────────────
function EarnRuleCard({ rule, config, setTab, openSurvey, isClaimed, onClaimSuccess }) {
  const accentColor = config.accentColor || '#6366f1';
  const ruleType    = inferRuleType(rule);
  const icon        = getRuleIcon({ ...rule, rule_type: ruleType });
  const pts         = getPointLabel(rule);
  const name        = rule.name || rule.label || 'Earn points';

  // Date-based rules show "saved" when the profile already has the value
  // Signup rules are auto-earned — always show as claimed
  const isSaved = isClaimed ||
    ruleType === 'signup' ||
    (ruleType === 'birthday'    && rule.saved_value) ||
    (ruleType === 'anniversary' && rule.saved_value);

  const handleAction = useCallback(() => {
    if (isSaved) return;
    const shop = typeof window !== 'undefined'
      ? (window.Shopify?.shop || window.location?.hostname || '')
      : '';
    if (ruleType === 'referral')         return setTab?.('refer');
    if (ruleType === 'survey')           return openSurvey?.();
    if (ruleType === 'profile_complete') return setTab?.('profile');
    if (ruleType === 'birthday')         return setTab?.('profile');
    if (ruleType === 'anniversary')      return setTab?.('profile');
    if (ruleType === 'order')            return window.open(`https://${shop}`, '_blank', 'noopener');
    if (ruleType === 'social') {
      // Use unified submit-action-reward function; callback refreshes earn rules list
      handleSocialActionClaim(rule, shop, onClaimSuccess);
      return;
    }
    if (ruleType === 'review') {
      // Use unified submit-action-reward function; callback refreshes earn rules list
      handleSocialActionClaim(rule, shop, onClaimSuccess);
      return;
    }
    if (ruleType === 'signup') return; // Auto-awarded on registration
  }, [ruleType, rule, isSaved, setTab, openSurvey, onClaimSuccess]);

  function ctaLabel() {
    if (isSaved)                              return '✓ Claimed';
    if (ruleType === 'order')                 return 'Shop Now';
    if (ruleType === 'referral')              return 'Invite';
    if (ruleType === 'survey')                return 'Take Survey';
    if (ruleType === 'birthday')              return rule.saved_value ? '✓ Saved' : 'Add Date';
    if (ruleType === 'anniversary')           return rule.saved_value ? '✓ Saved' : 'Add Date';
    if (ruleType === 'profile_complete')      return 'Complete';
    if (ruleType === 'social')                return 'Follow';
    if (ruleType === 'review')                return 'Review';    if (ruleType === 'signup')                return '\u2713 Auto-Earned';    return 'Earn';
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 14,
      background: tokens.surface,
      border: `1px solid ${tokens.border}`,
      borderRadius: tokens.radiusLg,
      marginBottom: 10,
      opacity: isClaimed ? 0.55 : 1,
      transition: 'opacity 0.15s',
      position: 'relative',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: accentSoft(accentColor),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: tokens.text }}>{name}</div>
        {rule.featured && !isClaimed && (
          <span style={{
            display: 'inline-block', marginTop: 4, marginRight: 6,
            background: tokens.warning, color: '#fff',
            fontSize: 10, fontWeight: 700, borderRadius: 999,
            padding: '2px 8px', textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            Popular
          </span>
        )}
        {pts && (
          <div style={{ fontSize: 12, color: tokens.successText, fontWeight: 600, marginTop: 4 }}>
            {pts}
          </div>
        )}
        {rule.description && (
          <div style={{
            fontSize: 11, color: tokens.textMuted, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {rule.description}
          </div>
        )}
      </div>
      <button
        onClick={handleAction}
        disabled={isSaved}
        style={{
          background: isSaved ? tokens.successSoft : accentSoft(accentColor),
          color:      isSaved ? tokens.successText : accentColor,
          border:     isSaved ? `1px solid ${tokens.successText}33` : 'none',
          borderRadius: tokens.radiusMd,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 600,
          cursor: isSaved ? 'default' : 'pointer',
          whiteSpace: 'nowrap', flexShrink: 0,
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => { if (!isSaved) { e.target.style.background = accentColor; e.target.style.color = '#fff'; } }}
        onMouseLeave={(e) => { if (!isSaved) { e.target.style.background = accentSoft(accentColor); e.target.style.color = accentColor; } }}
      >
        {ctaLabel()}
      </button>
    </div>
  );
}

export default MemberEarn;
