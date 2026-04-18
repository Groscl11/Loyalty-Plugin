/**
 * MemberRedeem — GoSelf Loyalty Widget V6
 * 3 sub-tabs: Store | Partners | Free Products
 * Opens VoucherModal on redeem action.
 */

import React, { useState, useCallback } from 'react';
import VoucherModal from '../../components/VoucherModal.jsx';
import { SUPABASE_URL, SUPABASE_HEADERS } from '../../utils/supabase.js';

const SUB_TABS = ['store', 'partners', 'free'];

const MemberRedeem = React.memo(function MemberRedeem({ data, config }) {
  const [subTab, setSubTab]         = useState('store');
  const [voucherItem, setVoucherItem] = useState(null);

  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState(null);

  const redeemCat  = data.redeemCatalog || {};
  const customer   = data.customer || {};
  const shopDomain = (typeof window !== 'undefined' && (window.Shopify?.shop || window.location?.hostname)) || '';

  // Prefer backend-grouped catalog; fall back to legacy flat catalog
  const storeItems   = redeemCat.discountRewards || (data.catalog || []).filter(r => r.type === 'discount');
  const partnerItems = redeemCat.brandRewards    || (data.catalog || []).filter(r => r.type === 'partner');
  const freeItems    = redeemCat.manualRewards   || (data.catalog || []).filter(r => r.type === 'free');
  const existingCodes      = redeemCat.existingCodes      || {};
  const existingBrandCodes = redeemCat.existingBrandCodes || {};

  const handleRedeem = useCallback(async (item) => {
    // If already claimed, show existing code in modal
    const existingCode = item.type === 'partner'
      ? (existingBrandCodes[item.rewardId] || existingBrandCodes[item.id] || existingCodes[item.rewardId] || existingCodes[item.id])
      : existingCodes[item.id];

    if (existingCode) {
      setVoucherItem({
        code:          existingCode.code || null,
        title:         item.title,
        brandName:     item.brandName || null,
        brandUrl:      item.brandUrl  || null,
        isPartner:     item.type === 'partner',
        isFreeProduct: item.type === 'free',
        accentColor:   item.type === 'partner' ? '#10b981' : item.type === 'free' ? '#16a34a' : config.accentColor,
        discountValue: item.discountValue,
      });
      return;
    }

    const canAfford = customer.pointsBalance >= item.pointsCost;
    if (!canAfford || redeeming) return;

    setRedeeming(true);
    setRedeemError(null);
    let code = null;
    try {
      // Store and partner rewards go through redeem-reward endpoint.
      // distribution_id is passed for partner rewards so the server can resolve
      // the correct offer_distributions row (and authoritative points_cost).
      const redeemBody = {
        member_user_id: customer.customerId || null,   // UUID only — null makes backend use email fallback
        email:          customer.email || null,
        shop_domain:    shopDomain,
        reward_id:      item.type === 'partner' ? item.rewardId : item.id,
      };
      if (item.type === 'partner' && item.id) {
        redeemBody.config_id = item.id; // item.id is config_id (offer_distributions.id)
      }
      console.log('[GoSelf] redeem request:', JSON.stringify(redeemBody));
      const res = await fetch(`${SUPABASE_URL}/functions/v1/redeem-reward`, {
        method: 'POST',
        headers: SUPABASE_HEADERS,
        body: JSON.stringify(redeemBody),
      });
      const json = await res.json();
      console.log('[GoSelf] redeem response:', JSON.stringify(json));
      if (json.success === false || json.error) {
        const debugSuffix = json.current_points !== undefined
          ? ` — backend sees balance:${json.current_points} cost:${json.required_points}`
          : '';
        setRedeemError((json.error || 'Redemption failed. Please try again.') + debugSuffix);
        setRedeeming(false);
        return;
      }
      code = json.discount_code || json.code || json.voucher_code || null;
      data.refetch('member_rewards');
      data.refetch('wallet');
      data.refetch('customer_session');
    } catch (e) {
      console.warn('[GoSelf] redeem failed:', e.message);
      setRedeemError('Could not connect. Please check your connection and try again.');
      setRedeeming(false);
      return;
    } finally {
      setRedeeming(false);
    }

    setVoucherItem({
      code:          code || item.code || null,
      title:         item.title,
      brandName:     item.brandName || null,
      brandUrl:      item.brandUrl  || null,
      isPartner:     item.type === 'partner',
      isFreeProduct: item.type === 'free',
      accentColor:   item.type === 'partner' ? '#10b981' : item.type === 'free' ? '#16a34a' : config.accentColor,
      discountValue: item.discountValue,
    });
  }, [customer, shopDomain, data, config.accentColor, redeeming, existingCodes, existingBrandCodes]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>

      {/* Balance strip */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#6b7280' }}>
        Balance: <strong style={{ color: '#111827' }}>
          {Number(customer.pointsBalance || 0).toLocaleString('en-IN')} {config.pointsAbbrev}
        </strong>
      </div>

      {/* Error toast */}
      {redeemError && (
        <div
          style={{
            margin: '8px 16px 0',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            color: '#dc2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>⚠ {redeemError}</span>
          <button
            onClick={() => setRedeemError(null)}
            style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', fontSize: 14, padding: 0 }}
          >×</button>
        </div>
      )}

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

        {subTab === 'store' && storeItems.map(item => (
          <RedeemCard
            key={item.id}
            item={item}
            config={config}
            balance={customer.pointsBalance || 0}
            ctaLabel={redeeming ? '…' : 'Redeem'}
            accentColor={config.accentColor}
            onAction={() => handleRedeem(item)}
            existingCode={existingCodes[item.id] || null}
          />
        ))}

        {subTab === 'partners' && (
          <>
            {partnerItems.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, paddingTop: 40 }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🤝</div>
                <div style={{ fontWeight: 600, color: '#374151', marginBottom: 6 }}>No partner offers right now</div>
                <div style={{ fontSize: 11, lineHeight: 1.5 }}>Check back soon for exclusive partner rewards.</div>
              </div>
            ) : partnerItems.map(item => (
              <RedeemCard
                key={item.id}
                item={item}
                config={config}
                balance={customer.pointsBalance || 0}
                ctaLabel="Claim"
                accentColor="#10b981"
                onAction={() => handleRedeem(item)}
                existingCode={existingBrandCodes[item.rewardId] || existingBrandCodes[item.id] || existingCodes[item.rewardId] || existingCodes[item.id] || null}
              />
            ))}
          </>
        )}

        {subTab === 'free' && (
          <>
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
              🛒 Redeem points → added to cart at ₹0 via Shopify Functions
            </div>
            {freeItems.map(item => (
              <RedeemCard
                key={item.id}
                item={item}
                config={config}
                balance={customer.pointsBalance || 0}
                ctaLabel="Add Free"
                accentColor="#16a34a"
                onAction={() => handleRedeem(item)}
                existingCode={existingCodes[item.id] || null}
              />
            ))}
          </>
        )}
      </div>

      {/* Voucher modal */}
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

function RedeemCard({ item, config, balance, ctaLabel, accentColor, onAction, existingCode }) {
  const canAfford = balance >= item.pointsCost;
  const isClaimed = !!existingCode;
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!existingCode?.code) return;
    const code = existingCode.code;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => fallbackCopy(code));
    } else {
      fallbackCopy(code);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [existingCode]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 14px',
      border: '1px solid #f3f4f6',
      borderRadius: 12,
      background: isClaimed ? '#fafffe' : '#fff',
      marginBottom: 10,
      opacity: !isClaimed && !canAfford ? 0.65 : 1,
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 10,
        background: `${accentColor}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, fontWeight: 700, fontSize: 11, color: accentColor,
        textAlign: 'center', padding: '2px',
      }}>
        {item.discountValue}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title}
        </div>
        {item.brandName && (
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>{item.brandName}</div>
        )}
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>
          {Number(item.pointsCost).toLocaleString('en-IN')} {config.pointsAbbrev}
        </div>
      </div>

      {isClaimed ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
          <div style={{
            background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
            padding: '4px 10px', fontSize: 11, fontWeight: 700, color: '#16a34a',
          }}>
            ✓ Claimed
          </div>
          {existingCode.code && (
            <button onClick={handleCopy} style={{
              background: copied ? '#16a34a' : '#f3f4f6',
              color: copied ? '#fff' : '#374151',
              border: 'none', borderRadius: 6,
              padding: '3px 8px', fontSize: 10, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'monospace', whiteSpace: 'nowrap',
            }}>
              {copied ? '✓ Copied!' : existingCode.code}
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={onAction}
          disabled={!canAfford}
          style={{
            background: canAfford ? accentColor : '#e5e7eb',
            color: canAfford ? '#fff' : '#9ca3af',
            border: 'none', borderRadius: 8, padding: '7px 14px',
            fontSize: 12, fontWeight: 600,
            cursor: canAfford ? 'pointer' : 'not-allowed',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

function fallbackCopy(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

export default MemberRedeem;
