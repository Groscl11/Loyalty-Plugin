/**
 * MemberProfile — GoSelf Loyalty Widget V6
 * Sticky layout: progress bar (never scrolls) + scrollable fields + sticky save button.
 * Profile data is persisted in localStorage so it survives page refreshes.
 */

import React, { useState, useCallback } from 'react';
import { SUPABASE_URL, SUPABASE_HEADERS } from '../../utils/supabase.js';

const FIELDS = ['firstName', 'email', 'phone', 'dob', 'anniversary'];
const FIELD_META = {
  firstName:   { label: 'First Name',    type: 'text',  readOnly: false },
  email:       { label: 'Email',         type: 'email', readOnly: true  },
  phone:       { label: 'Phone',         type: 'tel',   readOnly: false },
  dob:         { label: 'Birthday',      type: 'date',  readOnly: false },
  anniversary: { label: 'Anniversary',   type: 'date',  readOnly: false },
};

// ── LocalStorage helpers ──────────────────────────────────────────────────────
function profileCacheKey(email) {
  return `goself_prf_${(email || '').replace(/[^a-z0-9@._]/gi, '_')}`;
}
function loadProfileCache(email) {
  try {
    const raw = localStorage.getItem(profileCacheKey(email));
    if (!raw) return null;
    const d = JSON.parse(raw);
    // 30-day TTL
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
  } catch { /* ignore storage errors */ }
}

const MemberProfile = React.memo(function MemberProfile({ data, config }) {
  const customer = data.customer || {};

  // Prefer customer object, fall back to localStorage (survives page refresh)
  const cached = loadProfileCache(customer.email);

  const [form, setForm] = useState({
    firstName:   customer.firstName   || cached?.firstName   || '',
    email:       customer.email       || '',
    phone:       customer.phone       || cached?.phone       || '',
    dob:         customer.dob         || cached?.dob         || '',
    anniversary: customer.anniversary || cached?.anniversary || '',
  });
  const [saving, setSaving]         = useState(false);
  const [savedMsg, setSavedMsg]     = useState(null);
  const [savedPts, setSavedPts]     = useState(0);

  // Derive bonus pts from earn rules if available, fallback to 100
  const profileRule = (data.earnRules || []).find(r =>
    r.rule_type === 'profile_complete' ||
    (r.name || r.label || '').toLowerCase().includes('profile')
  );
  const bonusPts = profileRule?.points_reward || 100;

  // Profile completeness — computed from live form state (updates as user types)
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
    setSavedPts(0);
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

      // Persist to localStorage so fields survive refresh
      saveProfileCache(customer.email, {
        firstName:   form.firstName,
        phone:       form.phone,
        dob:         form.dob,
        anniversary: form.anniversary,
      });

      const pts = json.points_awarded || 0;
      setSavedPts(pts);

      if (pts > 0) {
        setSavedMsg(`✓ Profile complete! +${pts} ${config.pointsNoun} awarded`);
      } else {
        setSavedMsg('✓ Profile saved');
      }
      setTimeout(() => setSavedMsg(null), 4000);

      // Clear caches so next render fetches fresh data from backend
      try {
        sessionStorage.removeItem('goself:customer_session');
        sessionStorage.removeItem('goself:earn_rules');
      } catch (_) {}

      // Trigger background refetch so earn tab shows "✓ Claimed"
      data.refetch('customer_session');
      if (pts > 0) data.refetch('earn_rules');

    } catch (_) {
      setSavedMsg('⚠ Save failed — please try again.');
    } finally {
      setSaving(false);
    }
  }, [form, customer.email, config.pointsNoun, data]);

  // Dynamic button label
  function saveBtnLabel() {
    if (saving) return 'Saving…';
    if (!isComplete) return `Save & Earn +${bonusPts} ${config.pointsNoun}`;
    return 'Save Profile';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ─── Sticky progress bar ─── */}
      <div style={{ flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
            Profile {fillPct}% complete
          </span>
          {!isComplete ? (
            <span style={{ fontSize: 11, color: config.accentColor }}>
              +{bonusPts} {config.pointsNoun} on completion
            </span>
          ) : (
            <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>
              ✓ All fields filled
            </span>
          )}
        </div>
        <div style={{ height: 6, borderRadius: 99, background: '#e5e7eb', overflow: 'hidden' }}>
          <div style={{
            width: `${fillPct}%`,
            height: '100%',
            background: isComplete ? '#16a34a' : config.accentColor,
            borderRadius: 99,
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* ─── Scrollable fields ─── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 10px' }}>
        {FIELDS.map(field => {
          const meta = FIELD_META[field];
          return (
            <div key={field} style={{ marginBottom: 14 }}>
              <label style={{
                display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280',
                marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {meta.label}
                {meta.readOnly && (
                  <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: 4 }}>(read-only)</span>
                )}
              </label>
              <input
                type={meta.type}
                value={form[field]}
                readOnly={meta.readOnly}
                onChange={meta.readOnly ? undefined : e => handleChange(field, e.target.value)}
                style={{
                  width: '100%', padding: '9px 12px',
                  border: '1px solid #e5e7eb', borderRadius: 8,
                  fontSize: 13,
                  color: meta.readOnly ? '#9ca3af' : '#111827',
                  background: meta.readOnly ? '#f9fafb' : '#fff',
                  boxSizing: 'border-box', outline: 'none',
                  cursor: meta.readOnly ? 'default' : 'text',
                }}
              />
            </div>
          );
        })}
      </div>

      {/* ─── Sticky save button ─── */}
      <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid #f3f4f6', background: '#fff' }}>
        {savedMsg && (
          <div style={{
            fontSize: 12,
            color: savedMsg.startsWith('✓') ? '#16a34a' : '#dc2626',
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
            background: saving ? '#e5e7eb' : config.accentColor,
            color: saving ? '#9ca3af' : '#fff',
            border: 'none', borderRadius: 10,
            padding: '11px 0', fontSize: 14, fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saveBtnLabel()}
        </button>
      </div>
    </div>
  );
});

export default MemberProfile;
