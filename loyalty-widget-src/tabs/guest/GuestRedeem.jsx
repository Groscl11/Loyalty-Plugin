/**
 * GuestRedeem — real rewards catalog for unauthenticated visitors.
 *
 * Uses actual redeemCatalog data (fetched without auth — same catalog, 0 points balance).
 * Each card shows the reward details with a lock replacing the redeem button.
 * Falls back to generic teaser cards if catalog fetch returned nothing.
 */

import React, { useState } from 'react';
import { tokens, accentSoft, fmtPts } from '../../utils/tokens.js';

// Generic teaser cards — shown only when catalog is truly empty
const TEASER_CARDS = [
  { id: 't1', _type: 'store',   icon: '💸', title: 'Store Discount',    desc: 'Cashback on your next purchase',     pts: '500 – 2,000 pts' },
  { id: 't2', _type: 'store',   icon: '🛍️', title: 'Free Shipping',     desc: 'Waive delivery fees on any order',   pts: '300 pts' },
  { id: 't3', _type: 'partner', icon: '🎁', title: 'Partner Voucher',   desc: 'Exclusive offers from partner brands', pts: '1,000 pts' },
  { id: 't4', _type: 'store',   icon: '✨', title: 'Premium Reward',    desc: 'Members-only exclusive perk',         pts: '5,000 pts' },
];

const FILTER_TABS = [
  { id: 'all',     label: 'All'        },
  { id: 'store',   label: 'Store'      },
  { id: 'partner', label: 'Partners'   },
  { id: 'free',    label: 'Marketplace'},
];

const TYPE_STYLE = {
  store:   { label: 'Store reward',   color: '#2563eb', bg: '#eff6ff' },
  partner: { label: 'Partner offer',  color: '#db2777', bg: '#fce7f3' },
  free:    { label: 'Marketplace',    color: '#16a34a', bg: '#dcfce7' },
};

const GuestRedeem = React.memo(function GuestRedeem({ data, config, onGate }) {
  const [filter, setFilter] = useState('all');

  const { redeemCatalog } = data;
  const discounts = (redeemCatalog?.discountRewards || []).map(r => ({ ...r, _type: 'store'   }));
  const brands    = (redeemCatalog?.brandRewards    || []).map(r => ({ ...r, _type: 'partner' }));
  const manual    = (redeemCatalog?.manualRewards   || []).map(r => ({ ...r, _type: 'free'    }));
  const allReal   = [...discounts, ...brands, ...manual];
  const cards     = allReal.length > 0 ? allReal : TEASER_CARDS;

  // Filter tabs — only show if multiple types exist
  const counts = {
    all: cards.length,
    store:   cards.filter(c => c._type === 'store').length,
    partner: cards.filter(c => c._type === 'partner').length,
    free:    cards.filter(c => c._type === 'free').length,
  };
  const visibleFilters = FILTER_TABS.filter(f => {
    if (f.id === 'partner' && !config.showPartnerBrands) return false;
    if (f.id === 'free'    && !config.enableFreeProducts) return false;
    return f.id === 'all' || counts[f.id] > 0;
  });

  const filtered = filter === 'all' ? cards : cards.filter(c => c._type === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.surface }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 80px' }}>

        <div style={{ fontSize: 22, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>
          Rewards catalog
        </div>
        <div style={{ fontSize: 13, color: tokens.textMuted, marginBottom: 14 }}>
          Sign in to unlock and redeem with your {config.pointsNoun || 'points'}.
        </div>

        {/* Filter chips */}
        {visibleFilters.length > 2 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', paddingBottom: 2 }}>
            {visibleFilters.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  border: filter === f.id ? `1px solid ${config.accentColor}` : `1px solid ${tokens.border}`,
                  background: filter === f.id ? config.accentColor : tokens.surface,
                  color: filter === f.id ? '#fff' : tokens.text,
                  padding: '5px 12px', borderRadius: 999,
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {filtered.map(item => (
          <LockedRewardCard
            key={item.id}
            item={item}
            config={config}
            onGate={onGate}
          />
        ))}
      </div>

      {/* Sticky sign-in bar */}
      <div style={{
        position: 'sticky', bottom: 0,
        background: tokens.surface,
        borderTop: `1px solid ${tokens.border}`,
        padding: '12px 16px',
        flexShrink: 0,
      }}>
        <button
          onClick={() => onGate('unlock rewards')}
          style={{
            width: '100%', padding: 13,
            background: config.accentColor, color: '#fff',
            border: 'none', borderRadius: tokens.radiusLg,
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          🔓 Sign in to redeem rewards
        </button>
      </div>
    </div>
  );
});

function LockedRewardCard({ item, config, onGate }) {
  const ts = TYPE_STYLE[item._type] || TYPE_STYLE.store;
  const icon = item._type === 'partner' ? '👜' : item._type === 'free' ? '🎁' : '💸';
  const pts  = item.pts
    ?? (item.pointsCost != null ? `${fmtPts(item.pointsCost)} ${config.pointsAbbrev || 'pts'}` : '');

  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center',
      padding: 14, marginBottom: 10,
      border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg,
      background: tokens.surface,
      opacity: 0.72,
      position: 'relative',
    }}>
      {/* Lock badge */}
      <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 12, color: tokens.textSubtle }}>
        🔒
      </div>

      {/* Icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 10, background: ts.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, flexShrink: 0,
      }}>
        {icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: 20 }}>
        <span style={{
          display: 'inline-block', marginBottom: 4,
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
          color: ts.color, background: ts.bg, padding: '2px 8px', borderRadius: 999,
        }}>
          {ts.label}
        </span>
        <div style={{
          fontWeight: 600, fontSize: 14, color: tokens.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.title}
        </div>
        {(item.desc || item.description || item.brandName) && (
          <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 1 }}>
            {item.desc || item.description || item.brandName}
          </div>
        )}
        {pts && (
          <div style={{ fontSize: 12, color: tokens.text, fontWeight: 600, marginTop: 4 }}>
            {pts}
          </div>
        )}
      </div>
    </div>
  );
}

export default GuestRedeem;
