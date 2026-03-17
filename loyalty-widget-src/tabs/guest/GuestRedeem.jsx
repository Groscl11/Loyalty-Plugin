/**
 * GuestRedeem — GoSelf Loyalty Widget V6
 * 3 sub-tabs: Store | Partners | Free Products
 * Gate fires on action button click only.
 */

import React, { useState } from 'react';

const SUB_TABS = ['store', 'partners', 'free'];

const GuestRedeem = React.memo(function GuestRedeem({ data, config, onGate }) {
  const [subTab, setSubTab] = useState('store');

  const catalog = data.catalog || [];
  const storeItems   = catalog.filter(r => r.type === 'discount');
  const partnerItems = catalog.filter(r => r.type === 'partner');
  const freeItems    = catalog.filter(r => r.type === 'free');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', padding: '0 16px' }}>
        {SUB_TABS.map(t => {
          if (t === 'partners' && !config.showPartnerBrands) return null;
          if (t === 'free' && !config.enableFreeProducts) return null;
          const label = t === 'store' ? '🏪 Store' : t === 'partners' ? '🤝 Partners' : '🎁 Free';
          return (
            <button
              key={t}
              onClick={() => setSubTab(t)}
              style={{
                flex: 1,
                padding: '10px 0',
                border: 'none',
                background: 'transparent',
                borderBottom: subTab === t ? `2px solid ${config.accentColor}` : '2px solid transparent',
                color: subTab === t ? config.accentColor : '#6b7280',
                fontWeight: subTab === t ? 600 : 400,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 24px' }}>

        {subTab === 'store' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {storeItems.length === 0 && <EmptyState text="No store rewards available yet." />}
            {storeItems.map(item => (
              <RedeemCard
                key={item.id}
                item={item}
                config={config}
                ctaLabel="Redeem"
                onAction={() => onGate(`redeem "${item.title}"`)}
                accentColor={config.accentColor}
              />
            ))}
          </div>
        )}

        {subTab === 'partners' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {partnerItems.length === 0 && <EmptyState text="No partner offers available yet." />}
            {partnerItems.map(item => (
              <RedeemCard
                key={item.id}
                item={item}
                config={config}
                ctaLabel="Claim"
                onAction={() => onGate(`claim ${item.brandName || ''} ${item.discountValue} offer`)}
                accentColor="#10b981"
              />
            ))}
          </div>
        )}

        {subTab === 'free' && (
          <div>
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 12,
                color: '#92400e',
                marginBottom: 14,
              }}
            >
              🛒 Redeem points → item added to cart at ₹0 via Shopify Functions
            </div>
            {freeItems.length === 0 && <EmptyState text="No free products available yet." />}
            {freeItems.map(item => (
              <RedeemCard
                key={item.id}
                item={item}
                config={config}
                ctaLabel="Add Free"
                onAction={() => onGate(`add "${item.title}" free to your cart`)}
                accentColor="#16a34a"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

function RedeemCard({ item, config, ctaLabel, onAction, accentColor }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        border: '1px solid #f3f4f6',
        borderRadius: 12,
        background: '#fff',
      }}
    >
      {/* Discount badge */}
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 10,
          background: `${accentColor}18`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontWeight: 700,
          fontSize: 11,
          color: accentColor,
          textAlign: 'center',
          padding: '2px',
        }}
      >
        {item.discountValue}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title}
        </div>
        {item.brandName && (
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>{item.brandName}</div>
        )}
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
          {Number(item.pointsCost).toLocaleString('en-IN')} {config.pointsAbbrev}
        </div>
      </div>

      <button
        onClick={onAction}
        style={{
          background: accentColor,
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          padding: '7px 14px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {ctaLabel}
      </button>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af', fontSize: 13 }}>
      {text}
    </div>
  );
}

export default GuestRedeem;
