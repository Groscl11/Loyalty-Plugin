/**
 * MemberProfile — Profile tab acts as a hub in the new IA.
 *
 * Layout:
 *   1. Account info card (name, email, member-since)
 *   2. Hub nav rows: Wallet, Milestones, Activity history
 *   3. "Your details" form (existing profile edit, sticky save)
 *
 * Wallet, Milestones, History are reached via setTab() — they still have
 * dedicated tab components but no longer occupy a slot in the bottom nav.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { tokens, accentSoft, fmtPts } from '../../utils/tokens.js';
import { SUPABASE_URL, SUPABASE_HEADERS } from '../../utils/supabase.js';

const FIELDS = ['firstName', 'email', 'phone', 'dob', 'anniversary'];
const FIELD_META = {
  firstName:   { label: 'First Name',  type: 'text',  readOnly: false },
  email:       { label: 'Email',       type: 'email', readOnly: true  },
  phone:       { label: 'Phone',       type: 'tel',   readOnly: false },
  dob:         { label: 'Birthday',    type: 'date',  readOnly: false },
  anniversary: { label: 'Anniversary', type: 'date',  readOnly: false },
};

function profileCacheKey(email) {
  return `goself_prf_${(email || '').replace(/[^a-z0-9@._]/gi, '_')}`;
}
function loadProfileCache(email) {
  try {
    const raw = localStorage.getItem(profileCacheKey(email));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.savedAt && Date.now() - d.savedAt > 30 * 86400 * 1000) {
      localStorage.removeItem(profileCacheKey(email));
      return null;
    }
    return d;
  } catch { return null; }
}
function saveProfileCache(email, fields) {
  try {
    localStorage.setItem(profileCacheKey(email), JSON.stringify({ ...fields, savedAt: Date.now() }));
  } catch {}
}

const MemberProfile = React.memo(function MemberProfile({ data, config, setTab }) {
  const customer = data.customer || {};
  const wallet     = data.wallet       || [];
  const redeemCat  = data.redeemCatalog || {};
  const milestones = data.milestones   || [];

  // Mirror combinedWallet logic from MemberWallet so the count here matches
  // what's actually shown inside the wallet tab (existingCodes + existingBrandCodes).
  const activeVouchers = useMemo(() => {
    const seenCodes = new Set(wallet.map(w => w.code).filter(Boolean));
    let extra = 0;
    const countNew = (entries) => {
      if (!entries) return;
      Object.values(entries).forEach(entry => {
        const code = typeof entry === 'string' ? entry : (entry?.code || entry?.discount_code || null);
        if (code && !seenCodes.has(code)) { seenCodes.add(code); extra++; }
      });
    };
    countNew(redeemCat.existingCodes);
    countNew(redeemCat.existingBrandCodes);
    return wallet.filter(c => c.status === 'active').length + extra;
  }, [wallet, redeemCat]);
  const completedMilestones = milestones.filter(m => m.isCompleted).length;
  const totalMilestones = milestones.length;

  const cached = loadProfileCache(customer.email);

  const [form, setForm] = useState({
    firstName:   customer.firstName   || cached?.firstName   || '',
    email:       customer.email       || '',
    phone:       customer.phone       || cached?.phone       || '',
    dob:         customer.dob         || cached?.dob         || '',
    anniversary: customer.anniversary || cached?.anniversary || '',
  });
  const [saving, setSaving]     = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);

  const profileRule = (data.earnRules || []).find(r =>
    r.rule_type === 'profile_complete' ||
    (r.name || r.label || '').toLowerCase().includes('profile')
  );
  const bonusPts = profileRule?.points_reward || 100;

  const editableFields = FIELDS.filter(f => !FIELD_META[f].readOnly);
  const filledCount    = editableFields.filter(f => (form[f] || '').trim() !== '').length;
  const fillPct        = Math.round((filledCount / Math.max(1, editableFields.length)) * 100);
  const isComplete     = fillPct === 100;

  const handleChange = useCallback((field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSavedMsg(null);
    const shopDomain = (typeof window !== 'undefined' && (window.Shopify?.shop || window.location?.hostname)) || '';
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/update-customer-profile`, {
        method: 'POST',
        headers: SUPABASE_HEADERS,
        body: JSON.stringify({
          email:       customer.email,
          shop_domain: shopDomain,
          first_name:  form.firstName,
          phone:       form.phone,
          dob:         form.dob   || null,
          anniversary: form.anniversary || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      saveProfileCache(customer.email, {
        firstName: form.firstName, phone: form.phone,
        dob: form.dob, anniversary: form.anniversary,
      });
      const pts = json.points_awarded || 0;
      setSavedMsg(pts > 0
        ? `✓ Profile complete! +${pts} ${config.pointsNoun || 'points'} awarded`
        : '✓ Profile saved');
      setTimeout(() => setSavedMsg(null), 4000);
      try {
        sessionStorage.removeItem('goself:customer_session');
        sessionStorage.removeItem('goself:earn_rules');
      } catch {}
      data.refetch('customer_session');
      // Always refetch earn_rules so birthday/anniversary saved_value and
      // profile_complete is_completed reflect the latest save immediately.
      data.refetch('earn_rules');
    } catch {
      setSavedMsg('⚠ Save failed — please try again.');
    } finally {
      setSaving(false);
    }
  }, [form, customer.email, config.pointsNoun, data]);

  function saveBtnLabel() {
    if (saving) return 'Saving…';
    if (!isComplete) return `Save & Earn +${bonusPts} ${config.pointsNoun || 'pts'}`;
    return 'Save Profile';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 12px' }}>

        {/* ─── Account info card ─────────────────────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: tokens.text, marginBottom: 8 }}>
            {customer.firstName || 'Member'}
            {customer.firstName && (
              <span style={{ fontWeight: 400, color: tokens.textMuted, fontSize: 16 }}>
                {' '}· {config.tierNames?.[customer.tier] || customer.tier}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: tokens.textMuted }}>
            {customer.email}
          </div>
          {customer.lifetimeEarned > 0 && (
            <div style={{ fontSize: 12, color: tokens.textMuted, marginTop: 4 }}>
              {fmtPts(customer.lifetimeEarned)} {config.pointsAbbrev || 'pts'} earned · {fmtPts(customer.lifetimeRedeemed || 0)} redeemed
            </div>
          )}
        </div>

        {/* ─── Hub nav rows ──────────────────────────────────────────── */}
        <HubRow
          icon="💼"
          title="Wallet"
          subtitle={`${activeVouchers} unused voucher${activeVouchers !== 1 ? 's' : ''}`}
          badge={activeVouchers}
          accentColor={config.accentColor}
          onClick={() => setTab('wallet')}
        />
        {config.showMilestones !== false && (
          <HubRow
            icon="🏆"
            title="Milestones"
            subtitle={totalMilestones > 0
              ? `${completedMilestones} of ${totalMilestones} unlocked`
              : 'Earn points to unlock rewards'}
            accentColor={config.accentColor}
            onClick={() => setTab('milestones')}
          />
        )}
        <HubRow
          icon="📜"
          title="Activity"
          subtitle="See all your points history"
          accentColor={config.accentColor}
          onClick={() => setTab('history')}
        />

        {/* ─── Your details form ─────────────────────────────────────── */}
        <SectionHeader title="Your details" />
        <div style={{
          padding: '12px 14px', marginBottom: 12,
          background: accentSoft(config.accentColor),
          borderRadius: tokens.radiusMd,
          fontSize: 12, color: tokens.text,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Profile {fillPct}% complete</span>
          {!isComplete ? (
            <span style={{ fontWeight: 600, color: config.accentColor }}>
              +{bonusPts} {config.pointsAbbrev || 'pts'} on completion
            </span>
          ) : (
            <span style={{ fontWeight: 600, color: tokens.successText }}>
              ✓ All filled
            </span>
          )}
        </div>
        <div style={{ height: 4, borderRadius: 2, background: tokens.border, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{
            width: `${fillPct}%`, height: '100%',
            background: isComplete ? tokens.successText : config.accentColor,
            transition: 'width 0.4s ease',
          }} />
        </div>

        {FIELDS.map(field => {
          const meta = FIELD_META[field];
          return (
            <div key={field} style={{ marginBottom: 12 }}>
              <label style={{
                display: 'block', fontSize: 11, fontWeight: 600,
                color: tokens.textMuted, marginBottom: 4,
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {meta.label}
                {meta.readOnly && (
                  <span style={{ fontWeight: 400, color: tokens.textSubtle, marginLeft: 4 }}>
                    (read-only)
                  </span>
                )}
              </label>
              <input
                type={meta.type}
                value={form[field]}
                readOnly={meta.readOnly}
                onChange={meta.readOnly ? undefined : e => handleChange(field, e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px',
                  border: `1px solid ${tokens.border}`,
                  borderRadius: tokens.radiusMd,
                  fontSize: 13,
                  color: meta.readOnly ? tokens.textMuted : tokens.text,
                  background: meta.readOnly ? tokens.bg : tokens.surface,
                  boxSizing: 'border-box', outline: 'none',
                  cursor: meta.readOnly ? 'default' : 'text',
                }}
              />
            </div>
          );
        })}
      </div>

      {/* ─── Sticky save ───────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, padding: '12px 16px',
        borderTop: `1px solid ${tokens.borderSoft}`,
        background: tokens.surface,
      }}>
        {savedMsg && (
          <div style={{
            fontSize: 12,
            color: savedMsg.startsWith('✓') ? tokens.successText : '#dc2626',
            marginBottom: 8, textAlign: 'center', fontWeight: 500,
          }}>
            {savedMsg}
          </div>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: '100%',
            background: saving ? tokens.border : config.accentColor,
            color: saving ? tokens.textMuted : '#fff',
            border: 'none', borderRadius: tokens.radiusMd,
            padding: '12px 0', fontSize: 14, fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saveBtnLabel()}
        </button>
      </div>
    </div>
  );
});

function SectionHeader({ title }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: tokens.textMuted,
      margin: '20px 0 8px', textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      {title}
    </div>
  );
}

function HubRow({ icon, title, subtitle, badge, accentColor, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        background: tokens.surface, border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radiusLg, padding: 14, marginBottom: 8,
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: accentSoft(accentColor),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: tokens.textMuted, marginTop: 2 }}>
          {subtitle}
        </div>
      </div>
      {badge > 0 && (
        <span style={{
          background: tokens.danger, color: '#fff',
          padding: '2px 8px', borderRadius: 999,
          fontSize: 11, fontWeight: 700, minWidth: 22, textAlign: 'center',
        }}>
          {badge}
        </span>
      )}
      <span style={{ color: tokens.textSubtle, fontSize: 18 }}>›</span>
    </button>
  );
}

export default MemberProfile;
