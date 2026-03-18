/**
 * MemberWallet — GoSelf Loyalty Widget V6
 * Active / Used / Expired coupon list with copy, partner links, free product cart.
 */

import React, { useState, useCallback } from 'react';
import VoucherModal from '../../components/VoucherModal.jsx';
import { formatPoints } from '../../utils/formatPoints.js';

const FILTERS = ['active', 'used', 'expired'];

const FILTER_LABELS = { active: 'Active', used: 'Used', expired: 'Expired' };

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
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
  try { document.execCommand('copy'); } catch (_) { /* noop */ }
  document.body.removeChild(ta);
}

const MemberWallet = React.memo(function MemberWallet({ data, config, setTab }) {
  const [filter, setFilter]       = useState('active');
  const [copiedId, setCopiedId]   = useState(null);
  const [voucherItem, setVoucherItem] = useState(null);

  const wallet    = data.wallet      || [];
  const history   = data.history     || [];
  const redeemCat = data.redeemCatalog || {};
  const customer  = data.customer    || {};

  // Merge claimed codes from redeemCatalog into wallet so they always appear
  // even when get-loyalty-status doesn't return them in issued_coupons
  const claimedFromRedeem = [];
  if (redeemCat.existingCodes) {
    Object.entries(redeemCat.existingCodes).forEach(([rewardId, entry]) => {
      if (entry?.code && !wallet.some(w => w.code === entry.code)) {
        const reward = (redeemCat.discountRewards || []).find(r => r.id === rewardId)
                    || (redeemCat.manualRewards   || []).find(r => r.id === rewardId);
        if (reward) {
          claimedFromRedeem.push({
            id:           `claimed_${rewardId}`,
            type:         reward.type || 'discount',
            status:       'active',
            code:         entry.code,
            title:        reward.title,
            discountValue: reward.discountValue || '',
            expiresAt:    null,
          });
        }
      }
    });
  }
  if (redeemCat.existingBrandCodes) {
    Object.entries(redeemCat.existingBrandCodes).forEach(([rewardId, entry]) => {
      if (entry?.code && !wallet.some(w => w.code === entry.code)) {
        const reward = (redeemCat.brandRewards || []).find(r => r.rewardId === rewardId);
        if (reward) {
          claimedFromRedeem.push({
            id:           `claimed_brand_${rewardId}`,
            type:         'partner',
            status:       'active',
            code:         entry.code,
            title:        reward.title,
            brandName:    reward.brandName || null,
            brandUrl:     reward.brandUrl  || null,
            discountValue: reward.discountValue || '',
            expiresAt:    null,
          });
        }
      }
    });
  }
  const combinedWallet = [...wallet, ...claimedFromRedeem];

  // Use authoritative lifetime totals from the session when available;
  // fall back to computing from visible history (which may be truncated)
  const totalEarned   = customer.lifetimeEarned
                      || history.filter(h => h.delta > 0).reduce((s, h) => s + h.delta, 0);
  const totalRedeemed = customer.lifetimeRedeemed
                      || history.filter(h => h.delta < 0).reduce((s, h) => s + Math.abs(h.delta), 0);

  const filtered = combinedWallet.filter(c => c.status === filter);
  const counts   = { active: 0, used: 0, expired: 0 };
  combinedWallet.forEach(c => { if (counts[c.status] !== undefined) counts[c.status]++; });

  const handleCopy = useCallback((code, id) => {
    copyText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleViewFull = useCallback((coupon) => {
    setVoucherItem({
      code:          coupon.code,
      title:         coupon.title,
      brandName:     coupon.brandName || null,
      brandUrl:      coupon.brandUrl  || null,
      isPartner:     coupon.type === 'partner',
      isFreeProduct: coupon.type === 'free',
      accentColor:   coupon.type === 'partner' ? '#10b981'
                   : coupon.type === 'free'    ? '#16a34a'
                   : config.accentColor,
    });
  }, [config.accentColor]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>

      {/* Stats header */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #f3f4f6' }}>
        {[
          { label: 'Earned',   value: formatPoints(totalEarned,   config) },
          { label: 'Redeemed', value: formatPoints(totalRedeemed, config) },
          { label: 'Balance',  value: formatPoints(data.customer?.pointsBalance || 0, config) },
        ].map((s, i) => (
          <div
            key={s.label}
            style={{
              flex: 1,
              padding: '10px 6px',
              textAlign: 'center',
              borderRight: i < 2 ? '1px solid #f3f4f6' : 'none',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Ledger link */}
      <button
        onClick={() => setTab('history')}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '9px 16px',
          border: 'none',
          borderBottom: '1px solid #f3f4f6',
          background: `${config.accentColor}08`,
          cursor: 'pointer',
          fontSize: 12,
          color: config.accentColor,
          fontWeight: 500,
        }}
      >
        <span>📊 View full transaction ledger</span>
        <span>→</span>
      </button>

      {/* Filter tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', padding: '0 16px' }}>
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              flex: 1,
              padding: '10px 0',
              border: 'none',
              background: 'transparent',
              borderBottom: filter === f ? `2px solid ${config.accentColor}` : '2px solid transparent',
              color: filter === f ? config.accentColor : '#6b7280',
              fontWeight: filter === f ? 600 : 400,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {FILTER_LABELS[f]} ({counts[f]})
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 24px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, paddingTop: 40 }}>
            {filter === 'active' ? 'No active coupons — redeem to earn some!' : `No ${filter} coupons`}
          </div>
        ) : filtered.map(coupon => (
          <CouponCard
            key={coupon.id}
            coupon={coupon}
            config={config}
            isMuted={filter !== 'active'}
            copied={copiedId === coupon.id}
            onCopy={handleCopy}
            onViewFull={handleViewFull}
          />
        ))}
      </div>

      {voucherItem && (
        <VoucherModal
          item={voucherItem}
          config={config}
          onClose={() => setVoucherItem(null)}
        />
      )}
    </div>
  );
});

function CouponCard({ coupon, config, isMuted, copied, onCopy, onViewFull }) {
  const typeColor = coupon.type === 'partner' ? '#10b981'
                  : coupon.type === 'free'    ? '#16a34a'
                  : config.accentColor;

  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid #f3f4f6`,
        overflow: 'hidden',
        marginBottom: 10,
        opacity: isMuted ? 0.65 : 1,
      }}
    >
      {/* Colour strip */}
      <div style={{ height: 4, background: typeColor }} />

      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{coupon.title}</div>
            {coupon.brandName && (
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{coupon.brandName}</div>
            )}
          </div>
          {coupon.expiresAt && !isMuted && (
            <div style={{ fontSize: 10, color: '#f59e0b', whiteSpace: 'nowrap' }}>
              Exp {coupon.expiresAt}
            </div>
          )}
        </div>

        {/* Code box */}
        {coupon.code && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <div
              style={{
                flex: 1,
                fontFamily: 'monospace',
                fontSize: 13,
                letterSpacing: 1,
                background: '#f9fafb',
                border: '1px dashed #d1d5db',
                borderRadius: 6,
                padding: '6px 10px',
                color: '#374151',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {coupon.code}
            </div>
            {!isMuted && (
              <button
                onClick={() => onCopy(coupon.code, coupon.id)}
                style={{
                  background: copied ? '#d1fae5' : '#f3f4f6',
                  color: copied ? '#065f46' : '#374151',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'background 0.2s',
                }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            )}
          </div>
        )}

        {/* Action row */}
        {!isMuted && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {coupon.type === 'partner' && coupon.brandUrl && (
              <a
                href={coupon.brandUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1,
                  textAlign: 'center',
                  background: '#f0fdf4',
                  color: '#16a34a',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  padding: '7px 0',
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: 'none',
                  display: 'block',
                }}
              >
                Visit {coupon.brandName} →
              </a>
            )}
            {coupon.type === 'free' && (
              <button
                onClick={() => onViewFull(coupon)}
                style={{
                  flex: 1,
                  background: '#f0fdf4',
                  color: '#16a34a',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  padding: '7px 0',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🛒 View Details
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MemberWallet;
