/**
 * MemberWallet — voucher wallet (reached from Profile hub).
 *
 * Supports four display styles, controlled by config.walletVoucherStyle:
 *   'classic'  — simple row with copy button (original behaviour)
 *   'detail'   — row with › chevron; tap opens VoucherModal full-screen
 *   'chips'    — action chips (Steps ▾ / T&C ▾ / Redeem ↗) below each row [DEFAULT]
 *   'ticket'   — boarding-pass card with accent stripe, dashed divider, footer bar
 *
 * Data flow is unchanged — all four share the same combinedWallet merge logic.
 */

import React, { useState, useCallback, useMemo } from 'react';
import VoucherModal from '../../components/VoucherModal.jsx';
import { tokens, accentSoft, fmtPts } from '../../utils/tokens.js';

const FILTERS = ['active', 'used', 'expired'];
const FILTER_LABELS = { active: 'Active', used: 'Used', expired: 'Expired' };

// ─── helpers ─────────────────────────────────────────────────────────────────

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
}

function valueScore(coupon) {
  if (!coupon.discountValue) return 0;
  const m = String(coupon.discountValue).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return null;
  try {
    const d = new Date(expiresAt);
    const diffDays = Math.ceil((d.getTime() - Date.now()) / 86400000);
    if (diffDays <= 0)  return { label: 'Expired',           urgent: false, danger: true };
    if (diffDays === 1) return { label: 'Expires tomorrow',  urgent: true };
    if (diffDays <= 7)  return { label: `Expires in ${diffDays} days`, urgent: true };
    if (diffDays <= 30) return { label: `Expires in ${diffDays} days`, urgent: false };
    return { label: `Expires ${d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}`, urgent: false };
  } catch { return null; }
}

// Normalise stepsToRedeem from DB — stored as a newline-delimited string
// (e.g. "1. Open app\n2. Add to cart") but may also arrive as an array.
function normalizeSteps(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(s => (typeof s === 'string' ? s : s?.description || s?.step || '')).filter(Boolean);
  return String(raw).split('\n').map(s => s.replace(/^\d+[\.)]\s*/, '').trim()).filter(Boolean);
}

function getTypeInfo(coupon, accentColor) {
  if (coupon.type === 'partner')
    return { icon: '👜', bg: tokens.partnerSoft,  label: 'Partner',      accent: tokens.success };
  if (coupon.type === 'free')
    return { icon: '🎁', bg: tokens.successSoft,  label: 'Free product', accent: tokens.successText };
  return       { icon: '💸', bg: accentSoft(accentColor), label: 'Your store', accent: accentColor };
}

// Renders brand image when imageUrl is present; falls back to emoji icon
function VoucherIcon({ imageUrl, icon, bg, size = 40 }) {
  const [imgError, setImgError] = React.useState(false);
  const radius = Math.round(size * 0.25);
  if (imageUrl && !imgError) {
    return (
      <div style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', flexShrink: 0, border: `1px solid ${tokens.borderSoft}` }}>
        <img
          src={imageUrl}
          alt=""
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.5), flexShrink: 0,
    }}>{icon}</div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

const MemberWallet = React.memo(function MemberWallet({ data, config, setTab }) {
  const [filter, setFilter]           = useState('active');
  const [copiedId, setCopiedId]       = useState(null);
  const [voucherItem, setVoucherItem] = useState(null);

  const wallet    = data.wallet      || [];
  const history   = data.history     || [];
  const redeemCat = data.redeemCatalog || {};

  const style = config.walletVoucherStyle || 'chips';

  // ── Merge wallet sources ────────────────────────────────────────────────────
  const combinedWallet = useMemo(() => {
    const claimedFromRedeem = [];
    const seenCodes = new Set(wallet.map(w => w.code).filter(Boolean));

    function lookupReward(rewardId) {
      return (redeemCat.discountRewards || []).find(r => r.id === rewardId || r.rewardId === rewardId)
          || (redeemCat.brandRewards   || []).find(r => r.id === rewardId || r.rewardId === rewardId)
          || (redeemCat.manualRewards  || []).find(r => r.id === rewardId);
    }

    function pushFromMap(map, defaultType) {
      if (!map) return;
      Object.entries(map).forEach(([rewardId, entry]) => {
        const codeValue = typeof entry === 'string' ? entry : (entry?.code || entry?.discount_code || null);
        const expiresAt = typeof entry === 'string' ? null : (entry?.expires_at || null);
        if (!codeValue || seenCodes.has(codeValue)) return;
        seenCodes.add(codeValue);
        const reward = lookupReward(rewardId);
        claimedFromRedeem.push({
          id:             `claimed_${defaultType}_${rewardId}`,
          type:           reward?.type || defaultType,
          status:         'active',
          code:           codeValue,
          title:          reward?.title          || 'Reward',
          brandName:      reward?.brandName      || null,
          brandUrl:       reward?.brandUrl       || null,
          discountValue:  reward?.discountValue  || '',
          imageUrl:       reward?.imageUrl       || null,
          ownerName:      reward?.ownerName      || null,
          terms:          reward?.terms          || null,
          stepsToRedeem:  reward?.stepsToRedeem  || null,
          redemptionLink: reward?.redemptionLink || reward?.brandUrl || null,
          expiresAt,
        });
      });
    }

    pushFromMap(redeemCat.existingCodes,      'discount');
    pushFromMap(redeemCat.existingBrandCodes, 'partner');

    // History fallback
    history.filter(h => h.delta < 0 && h._meta?.code).forEach(h => {
      const codeValue = h._meta.code;
      if (!seenCodes.has(codeValue)) {
        seenCodes.add(codeValue);
        claimedFromRedeem.push({
          id: `txn_${h.id}`, type: 'partner', status: 'active',
          code: codeValue, title: h.label || 'Reward', expiresAt: null,
        });
      }
    });

    return [...wallet, ...claimedFromRedeem];
  }, [wallet, history, redeemCat]);

  const counts = { active: 0, used: 0, expired: 0 };
  combinedWallet.forEach(c => { if (counts[c.status] !== undefined) counts[c.status]++; });
  const filtered = combinedWallet.filter(c => c.status === filter);

  const totalValue = combinedWallet
    .filter(c => c.status === 'active')
    .reduce((s, c) => s + valueScore(c), 0);

  const handleCopy = useCallback((code, id) => {
    copyText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleOpenModal = useCallback((coupon) => {
    const ti = getTypeInfo(coupon, config.accentColor);
    setVoucherItem({
      code:           coupon.code,
      title:          coupon.title,
      brandName:      coupon.brandName      || null,
      brandUrl:       coupon.brandUrl       || null,
      redemptionLink: coupon.redemptionLink || null,
      stepsToRedeem:  normalizeSteps(coupon.stepsToRedeem),
      terms:          coupon.terms          || null,
      imageUrl:       coupon.imageUrl       || null,
      isPartner:      coupon.type === 'partner',
      isFreeProduct:  coupon.type === 'free',
      accentColor:    ti.accent,
    });
  }, [config.accentColor]);

  function renderRow(coupon) {
    const isMuted = filter !== 'active';
    const props = {
      key:         coupon.id,
      coupon,
      config,
      isMuted,
      copied:      copiedId === coupon.id,
      onCopy:      handleCopy,
      onOpenModal: handleOpenModal,
    };
    switch (style) {
      case 'detail':  return <VoucherRowDetail  {...props} />;
      case 'ticket':  return <VoucherRowTicket  {...props} />;
      case 'classic': return <VoucherRowClassic {...props} />;
      case 'chips':
      default:        return <VoucherRowChips   {...props} />;
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.surface }}>

      {/* Back strip */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px', background: tokens.bg,
        borderBottom: `1px solid ${tokens.borderSoft}`,
        fontSize: 13, fontWeight: 500, color: tokens.textMuted,
      }}>
        <button onClick={() => setTab('profile')} style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          padding: '4px 8px', borderRadius: tokens.radiusSm,
          color: tokens.text, fontSize: 14,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>← Profile</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px' }}>

        <div style={{ fontSize: 22, fontWeight: 600, color: tokens.text, marginBottom: 12 }}>
          Your wallet
        </div>

        {/* Summary stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div style={{ background: tokens.bg, borderRadius: tokens.radiusMd, padding: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: tokens.text }}>{counts.active}</div>
            <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 2 }}>Active vouchers</div>
          </div>
          <div style={{ background: tokens.bg, borderRadius: tokens.radiusMd, padding: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: tokens.text }}>
              {totalValue > 0 ? `~${totalValue}` : '—'}
            </div>
            <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 2 }}>Total value</div>
          </div>
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              border: filter === f ? `1px solid ${config.accentColor}` : `1px solid ${tokens.border}`,
              background: filter === f ? config.accentColor : tokens.surface,
              color: filter === f ? '#fff' : tokens.text,
              padding: '6px 12px', borderRadius: 999,
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              {FILTER_LABELS[f]}{counts[f] > 0 ? ` (${counts[f]})` : ''}
            </button>
          ))}
        </div>

        {/* Voucher list */}
        {filtered.length === 0 ? (
          <div style={{
            textAlign: 'center', color: tokens.textMuted, fontSize: 13,
            padding: '40px 0',
            border: `1px dashed ${tokens.border}`, borderRadius: tokens.radiusMd,
          }}>
            {filter === 'active' && '💼'}
            {filter === 'used'   && '✓'}
            {filter === 'expired'&& '⏳'}
            <div style={{ marginTop: 8, fontWeight: 500, color: tokens.text }}>No {filter} coupons</div>
            {filter === 'active' && (
              <div style={{ fontSize: 12, marginTop: 4 }}>Redeem points to unlock vouchers →</div>
            )}
          </div>
        ) : filtered.map(renderRow)}
      </div>

      {voucherItem && (
        <VoucherModal item={voucherItem} config={config} onClose={() => setVoucherItem(null)} />
      )}
    </div>
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// STYLE 1 — Classic
// ═════════════════════════════════════════════════════════════════════════════
function VoucherRowClassic({ coupon, config, isMuted, copied, onCopy, onOpenModal }) {
  const exp = formatExpiry(coupon.expiresAt);
  const ti  = getTypeInfo(coupon, config.accentColor);

  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center',
      padding: 14, marginBottom: 10,
      border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg,
      background: tokens.surface, opacity: isMuted ? 0.55 : 1,
    }}>
      <VoucherIcon imageUrl={coupon.imageUrl} icon={ti.icon} bg={ti.bg} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 2 }}>
          {coupon.title}
        </div>
        {coupon.code && (
          <div style={{ fontFamily: 'SF Mono, Monaco, Menlo, monospace', fontSize: 11, color: tokens.textMuted, letterSpacing: 1 }}>
            <span style={{ fontFamily: 'inherit', letterSpacing: 0, color: tokens.textSubtle }}>Code: </span>{coupon.code}
          </div>
        )}
        {!coupon.code && coupon.brandName && (
          <div style={{ fontSize: 11, color: tokens.textMuted }}>{coupon.brandName || ti.label}</div>
        )}
        {exp && (
          <div style={{
            fontSize: 11, marginTop: 4, fontWeight: 500,
            color: exp.danger ? tokens.danger : exp.urgent ? tokens.warning : tokens.textMuted,
          }}>
            {exp.urgent && '⚠ '}{exp.label}
          </div>
        )}
        {!isMuted && coupon.type === 'partner' && (coupon.redemptionLink || coupon.brandUrl) && (
          <a href={coupon.redemptionLink || coupon.brandUrl} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-block', marginTop: 6,
            color: tokens.successText, fontSize: 11, fontWeight: 600, textDecoration: 'none',
          }}>Visit {coupon.brandName || 'site'} →</a>
        )}
      </div>
      {!isMuted && coupon.code && (
        <button onClick={() => onCopy(coupon.code, coupon.id)} style={{
          background: copied ? tokens.successSoft : tokens.surface,
          color: copied ? tokens.successText : config.accentColor,
          border: `1px solid ${copied ? tokens.successText : config.accentColor}`,
          padding: '6px 12px', borderRadius: tokens.radiusMd,
          fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
        }}>{copied ? '✓ Copied' : 'Copy'}</button>
      )}
      {!isMuted && coupon.type === 'free' && !coupon.code && (
        <button onClick={() => onOpenModal(coupon)} style={{
          background: tokens.surface, color: tokens.successText,
          border: `1px solid ${tokens.successText}`,
          padding: '6px 12px', borderRadius: tokens.radiusMd,
          fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
        }}>Use now</button>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STYLE 2 — Detail View (tap row → full-screen VoucherModal)
// ═════════════════════════════════════════════════════════════════════════════
function VoucherRowDetail({ coupon, config, isMuted, copied, onCopy, onOpenModal }) {
  const exp = formatExpiry(coupon.expiresAt);
  const ti  = getTypeInfo(coupon, config.accentColor);
  const hasDetail = !isMuted && (normalizeSteps(coupon.stepsToRedeem).length > 0 || coupon.terms || coupon.redemptionLink);

  return (
    <div
      onClick={hasDetail ? () => onOpenModal(coupon) : undefined}
      style={{
        display: 'flex', gap: 12, alignItems: 'center',
        padding: 14, marginBottom: 10,
        border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg,
        background: tokens.surface, opacity: isMuted ? 0.55 : 1,
        cursor: hasDetail ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={hasDetail ? e => { e.currentTarget.style.borderColor = config.accentColor; } : undefined}
      onMouseLeave={hasDetail ? e => { e.currentTarget.style.borderColor = tokens.border; } : undefined}
    >
      <VoucherIcon imageUrl={coupon.imageUrl} icon={ti.icon} bg={ti.bg} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 2 }}>
          {coupon.title}
        </div>
        {coupon.code && (
          <div style={{ fontFamily: 'SF Mono, Monaco, Menlo, monospace', fontSize: 11, color: tokens.textMuted, letterSpacing: 1 }}>
            <span style={{ fontFamily: 'inherit', letterSpacing: 0, color: tokens.textSubtle }}>Code: </span>{coupon.code}
          </div>
        )}
        {!coupon.code && (
          <div style={{ fontSize: 11, color: tokens.textMuted }}>{coupon.brandName || ti.label}</div>
        )}
        {exp && (
          <div style={{
            fontSize: 11, marginTop: 4, fontWeight: 500,
            color: exp.danger ? tokens.danger : exp.urgent ? tokens.warning : tokens.textMuted,
          }}>
            {exp.urgent && '⚠ '}{exp.label}
          </div>
        )}
      </div>
      {!isMuted && coupon.code && (
        <button onClick={e => { e.stopPropagation(); onCopy(coupon.code, coupon.id); }} style={{
          background: copied ? tokens.successSoft : tokens.surface,
          color: copied ? tokens.successText : config.accentColor,
          border: `1px solid ${copied ? tokens.successText : config.accentColor}`,
          padding: '6px 12px', borderRadius: tokens.radiusMd,
          fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
        }}>{copied ? '✓' : 'Copy'}</button>
      )}
      {hasDetail && (
        <span style={{ color: tokens.textMuted, fontSize: 18, marginLeft: 4, flexShrink: 0 }}>›</span>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STYLE 3 — Action Chips  [DEFAULT]
// ═════════════════════════════════════════════════════════════════════════════
function VoucherRowChips({ coupon, config, isMuted, copied, onCopy }) {
  const [openPanel, setOpenPanel] = useState(null); // 'steps' | 'tc' | null
  const exp = formatExpiry(coupon.expiresAt);
  const ti  = getTypeInfo(coupon, config.accentColor);

  const steps     = normalizeSteps(coupon.stepsToRedeem);
  const hasSteps  = !isMuted && steps.length > 0;
  const hasTC     = !isMuted && !!coupon.terms;
  const hasRedeem = !isMuted && !!(coupon.redemptionLink || coupon.brandUrl);
  const hasChips  = hasSteps || hasTC || hasRedeem;

  function togglePanel(panel) { setOpenPanel(prev => prev === panel ? null : panel); }

  const chipBase = {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    background: tokens.bg, border: `1px solid ${tokens.border}`,
    borderRadius: 20, padding: '4px 10px',
    fontSize: 11, fontWeight: 600, color: tokens.text, cursor: 'pointer',
  };
  const chipActive = { background: accentSoft(config.accentColor), borderColor: config.accentColor, color: config.accentColor };

  return (
    <div style={{
      border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg,
      background: tokens.surface, marginBottom: 10,
      opacity: isMuted ? 0.55 : 1, overflow: 'hidden',
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px 8px' }}>
        <VoucherIcon imageUrl={coupon.imageUrl} icon={ti.icon} bg={ti.bg} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text, lineHeight: 1.3 }}>
            {coupon.title}
          </div>
          {coupon.code && (
            <div style={{ fontSize: 11, fontFamily: 'SF Mono, Monaco, Menlo, monospace', color: ti.accent, fontWeight: 700, marginTop: 2, letterSpacing: 0.5 }}>
              <span style={{ fontFamily: 'inherit', letterSpacing: 0, fontWeight: 500, color: tokens.textMuted }}>Code: </span>{coupon.code}
            </div>
          )}
          <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 1 }}>
            {coupon.brandName || ti.label}
          </div>
          {exp && (
            <div style={{ fontSize: 10, marginTop: 2, fontWeight: 500, color: exp.danger ? tokens.danger : exp.urgent ? tokens.warning : tokens.textMuted }}>
              {exp.urgent && '⚠ '}{exp.label}
            </div>
          )}
        </div>
        {!isMuted && coupon.code && (
          <button onClick={() => onCopy(coupon.code, coupon.id)} style={{
            background: copied ? tokens.successSoft : config.accentColor,
            color: copied ? tokens.successText : '#fff',
            border: 'none', padding: '5px 10px', borderRadius: tokens.radiusMd,
            fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
          }}>{copied ? '✓' : 'Copy'}</button>
        )}
      </div>

      {/* Chip bar */}
      {hasChips && (
        <div style={{ display: 'flex', gap: 6, padding: '0 14px 10px', flexWrap: 'wrap' }}>
          {hasSteps && (
            <button onClick={() => togglePanel('steps')}
              style={{ ...chipBase, ...(openPanel === 'steps' ? chipActive : {}) }}>
              📋 Steps {openPanel === 'steps' ? '▴' : '▾'}
            </button>
          )}
          {hasTC && (
            <button onClick={() => togglePanel('tc')}
              style={{ ...chipBase, ...(openPanel === 'tc' ? chipActive : {}) }}>
              📄 T&amp;C {openPanel === 'tc' ? '▴' : '▾'}
            </button>
          )}
          {hasRedeem && (
            <a href={coupon.redemptionLink || coupon.brandUrl} target="_blank" rel="noopener noreferrer"
              style={{ ...chipBase, background: '#ecfdf5', borderColor: tokens.success, color: tokens.successText, textDecoration: 'none' }}>
              🌐 Redeem ↗
            </a>
          )}
        </div>
      )}

      {/* Expand — Steps */}
      {openPanel === 'steps' && (
        <div style={{ padding: '10px 14px 12px', borderTop: `1px solid ${tokens.borderSoft}`, background: tokens.bg }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            How to Redeem
          </div>
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 5 }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                background: accentSoft(config.accentColor), color: config.accentColor,
                fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</div>
              <div style={{ fontSize: 11, color: tokens.text, lineHeight: 1.5 }}>{step}</div>
            </div>
          ))}
        </div>
      )}

      {/* Expand — T&C */}
      {openPanel === 'tc' && (
        <div style={{ padding: '10px 14px 12px', borderTop: `1px solid ${tokens.borderSoft}`, background: tokens.bg }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Terms &amp; Conditions
          </div>
          <div style={{ fontSize: 11, color: tokens.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {coupon.terms}
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STYLE 4 — Ticket / Boarding-pass Card
// ═════════════════════════════════════════════════════════════════════════════
function VoucherRowTicket({ coupon, config, isMuted, copied, onCopy }) {
  const [openPanel, setOpenPanel] = useState(null);
  const exp = formatExpiry(coupon.expiresAt);
  const ti  = getTypeInfo(coupon, config.accentColor);
  const accentHex = ti.accent;

  const steps     = normalizeSteps(coupon.stepsToRedeem);
  const hasSteps  = !isMuted && steps.length > 0;
  const hasTC     = !isMuted && !!coupon.terms;
  const hasRedeem = !isMuted && !!(coupon.redemptionLink || coupon.brandUrl);
  const hasFooter = hasSteps || hasTC || hasRedeem;

  function togglePanel(panel) { setOpenPanel(prev => prev === panel ? null : panel); }

  const accentLeft  = { borderLeft: `4px solid ${accentHex}` };
  const footerBtnBase = {
    flex: 1, background: 'none', border: 'none',
    borderRight: `1px solid ${tokens.borderSoft}`,
    padding: '7px 4px', fontSize: 10, fontWeight: 600,
    color: tokens.textMuted, cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  };

  return (
    <div style={{
      borderRadius: tokens.radiusLg, overflow: 'hidden',
      border: `1px solid ${tokens.border}`, marginBottom: 12,
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      opacity: isMuted ? 0.55 : 1,
    }}>
      {/* Top half */}
      <div style={{ ...accentLeft, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px 8px', background: tokens.surface }}>
        <VoucherIcon imageUrl={coupon.imageUrl} icon={ti.icon} bg={ti.bg} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {coupon.ownerName || coupon.brandName || 'Your store'} · {coupon.type === 'partner' ? 'Partner' : coupon.type === 'free' ? 'Gift' : 'Store'}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: tokens.text, lineHeight: 1.3, marginTop: 1 }}>
            {coupon.title}
          </div>
        </div>
        {coupon.discountValue && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: accentHex, lineHeight: 1 }}>{coupon.discountValue}</div>
            <div style={{ fontSize: 9, color: tokens.textMuted, fontWeight: 600 }}>OFF</div>
          </div>
        )}
      </div>

      {/* Perforated divider */}
      <div style={{ position: 'relative', height: 1, overflow: 'visible', margin: '0 0 0 4px' }}>
        <div style={{ position: 'absolute', top: 0, left: 10, right: 10, borderTop: `2px dashed ${tokens.border}` }} />
        <div style={{ position: 'absolute', top: -6, left: -8, width: 12, height: 12, borderRadius: '50%', background: tokens.bg, border: `1px solid ${tokens.border}` }} />
        <div style={{ position: 'absolute', top: -6, right: -4, width: 12, height: 12, borderRadius: '50%', background: tokens.bg, border: `1px solid ${tokens.border}` }} />
      </div>

      {/* Bottom half */}
      <div style={{ ...accentLeft, background: tokens.bg }}>
        <div style={{ padding: '8px 12px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
          {coupon.code ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 900, fontFamily: 'SF Mono, Monaco, Menlo, monospace', color: accentHex, letterSpacing: 1, flex: 1 }}>
                <span style={{ fontFamily: 'inherit', letterSpacing: 0, fontWeight: 500, fontSize: 11, color: tokens.textMuted }}>Code: </span>{coupon.code}
              </div>
              {!isMuted && (
                <button onClick={() => onCopy(coupon.code, coupon.id)} style={{
                  background: copied ? tokens.successSoft : accentHex,
                  color: copied ? tokens.successText : '#fff',
                  border: 'none', padding: '4px 10px', borderRadius: 6,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}>{copied ? '✓ Copied' : 'Copy'}</button>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12, color: tokens.textMuted, fontStyle: 'italic' }}>No code required</div>
          )}
        </div>
        {exp && (
          <div style={{ padding: '0 12px 6px', fontSize: 10, fontWeight: 500, color: exp.danger ? tokens.danger : exp.urgent ? tokens.warning : tokens.textMuted }}>
            {exp.urgent && '⚠ '}{exp.label}
          </div>
        )}

        {/* Footer action bar */}
        {!isMuted && hasFooter && (
          <div style={{ display: 'flex', borderTop: `1px solid ${tokens.borderSoft}` }}>
            {hasSteps && (
              <button onClick={() => togglePanel('steps')}
                style={{ ...footerBtnBase, ...(openPanel === 'steps' ? { color: config.accentColor, background: accentSoft(config.accentColor) } : {}) }}>
                <span style={{ fontSize: 13 }}>📋</span>Steps
              </button>
            )}
            {hasTC && (
              <button onClick={() => togglePanel('tc')}
                style={{ ...footerBtnBase, ...(openPanel === 'tc' ? { color: config.accentColor, background: accentSoft(config.accentColor) } : {}) }}>
                <span style={{ fontSize: 13 }}>📄</span>T&amp;C
              </button>
            )}
            {hasRedeem && (
              <a href={coupon.redemptionLink || coupon.brandUrl} target="_blank" rel="noopener noreferrer"
                style={{ ...footerBtnBase, borderRight: 'none', color: tokens.successText, textDecoration: 'none' }}>
                <span style={{ fontSize: 13 }}>🌐</span>Redeem
              </a>
            )}
            {!hasFooter && coupon.type !== 'partner' && (
              <div style={{ ...footerBtnBase, borderRight: 'none', cursor: 'default', color: tokens.textMuted }}>
                <span style={{ fontSize: 13 }}>🛒</span>At checkout
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expand panels */}
      {openPanel === 'steps' && (
        <div style={{ ...accentLeft, padding: '10px 12px 12px', borderTop: `1px solid ${tokens.borderSoft}`, background: tokens.surface }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>How to Redeem</div>
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 5 }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                background: accentSoft(config.accentColor), color: config.accentColor,
                fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</div>
              <div style={{ fontSize: 11, color: tokens.text, lineHeight: 1.5 }}>{step}</div>
            </div>
          ))}
        </div>
      )}
      {openPanel === 'tc' && (
        <div style={{ ...accentLeft, padding: '10px 12px 12px', borderTop: `1px solid ${tokens.borderSoft}`, background: tokens.surface }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Terms &amp; Conditions</div>
          <div style={{ fontSize: 11, color: tokens.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{coupon.terms}</div>
        </div>
      )}
    </div>
  );
}

export default MemberWallet;
