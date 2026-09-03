/**
 * MemberRedeem — rewards catalog with multi-type filter.
 *
 * Layout:
 *   1. Title + balance hint
 *   2. Wallet entry strip (jumps to MemberWallet)
 *   3. Filter chips: All / Your store / Partners / Marketplace
 *   4. Reward rows (sorted with claimed last, then by points cost)
 *
 * Preserves existing redeem flow: redeem-reward edge fn, existingCodes/
 * existingBrandCodes mapping, VoucherModal for success. Uses canonical
 * sub-types: store/partner/free (mapped to "Your store/Partners/Marketplace"
 * in the UI per the mockup).
 */

import React, { useState, useCallback, useMemo } from 'react';
import VoucherModal from '../../components/VoucherModal.jsx';
import { tokens, accentSoft, fmtPts } from '../../utils/tokens.js';
import { SUPABASE_URL, SUPABASE_HEADERS } from '../../utils/supabase.js';

const FILTERS = [
  { id: 'all',     label: 'All' },
  { id: 'store',   label: 'Your store' },
  { id: 'partner', label: 'Partners' },
  { id: 'free',    label: 'Marketplace' },
];

const TYPE_META = {
  store:   { icon: '💸', label: 'Your store',  bgGetter: (accent) => accentSoft(accent), textColorGetter: (accent) => accent },
  partner: { icon: '👜', label: 'Partner',     bgGetter: ()       => tokens.partnerSoft, textColorGetter: ()       => tokens.partner },
  free:    { icon: '🎁', label: 'Marketplace', bgGetter: ()       => tokens.successSoft, textColorGetter: ()       => tokens.successText },
};

function sortWithClaimedLast(items, existingCodeMap) {
  return [...items].sort((a, b) => {
    const aCode = existingCodeMap[a.id] || existingCodeMap[a.rewardId];
    const bCode = existingCodeMap[b.id] || existingCodeMap[b.rewardId];
    if (!aCode && bCode) return -1;
    if (aCode && !bCode) return 1;
    // Within unclaimed, cheapest first
    if (!aCode && !bCode) return (a.pointsCost || 0) - (b.pointsCost || 0);
    return 0;
  });
}

const MemberRedeem = React.memo(function MemberRedeem({ data, config, setTab }) {
  const [voucherItem, setVoucherItem]     = useState(null);
  const [redeeming, setRedeeming]         = useState(false);
  const [redeemError, setRedeemError]     = useState(null);
  const [filter, setFilter]               = useState('all');
  // Optimistic map: offerId → { code } — populated immediately after redemption
  // so "✓ Claimed" badge shows without waiting for the async refetch to complete.
  const [optimisticClaimed, setOptimisticClaimed] = useState({});

  const redeemCat  = data.redeemCatalog || {};
  const customer   = data.customer || {};
  const wallet     = data.wallet || [];
  const shopDomain = (typeof window !== 'undefined' && (window.Shopify?.shop || window.location?.hostname)) || '';
  const activeVouchers = wallet.filter(c => c.status === 'active').length;

  const existingCodes      = redeemCat.existingCodes      || {};
  const existingBrandCodes = redeemCat.existingBrandCodes || {};

  // Normalise + tag each item with a canonical type for filtering
  const allItems = useMemo(() => {
    const store = (redeemCat.discountRewards || (data.catalog || []).filter(r => r.type === 'discount')).map(r => ({ ...r, _type: 'store' }));
    const partner = (redeemCat.brandRewards || (data.catalog || []).filter(r => r.type === 'partner')).map(r => ({ ...r, _type: 'partner' }));
    const free = (redeemCat.manualRewards || (data.catalog || []).filter(r => r.type === 'free')).map(r => ({ ...r, _type: 'free' }));

    const sortedStore   = sortWithClaimedLast(store,   existingCodes);
    const sortedPartner = sortWithClaimedLast(partner, { ...existingCodes, ...existingBrandCodes });
    const sortedFree    = sortWithClaimedLast(free,    existingCodes);

    return [...sortedStore, ...sortedPartner, ...sortedFree];
  }, [redeemCat, data.catalog, existingCodes, existingBrandCodes]);

  // Filter availability — hide partner/free chips if disabled by merchant or empty
  const counts = {
    all:     allItems.length,
    store:   allItems.filter(i => i._type === 'store').length,
    partner: allItems.filter(i => i._type === 'partner').length,
    free:    allItems.filter(i => i._type === 'free').length,
  };
  const visibleFilters = FILTERS.filter(f => {
    if (f.id === 'partner' && !config.showPartnerBrands) return false;
    if (f.id === 'free'    && !config.enableFreeProducts) return false;
    return f.id === 'all' || counts[f.id] > 0;
  });

  const filteredItems = filter === 'all' ? allItems : allItems.filter(i => i._type === filter);

  const handleRedeem = useCallback(async (item) => {
    const type = item._type;
    const existingCode =
      optimisticClaimed[item.rewardId] || optimisticClaimed[item.id] ||
      (type === 'partner'
        ? (existingBrandCodes[item.rewardId] || existingBrandCodes[item.id] || existingCodes[item.rewardId] || existingCodes[item.id])
        : existingCodes[item.id]);

    if (existingCode) {
      setVoucherItem({
        code: existingCode.code || null,
        title: item.title,
        brandName: item.brandName || null,
        brandUrl: item.brandUrl || null,
        isPartner: type === 'partner',
        isFreeProduct: type === 'free',
        accentColor: TYPE_META[type].textColorGetter(config.accentColor),
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
      const redeemBody = {
        member_user_id: customer.customerId || null,
        email:          customer.email || null,
        shop_domain:    shopDomain,
        reward_id:      type === 'partner' ? item.rewardId : item.id,
        redeemed_from:  'loyalty_widget',
      };
      if (type === 'partner' && item.id) redeemBody.config_id = item.id;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/redeem-reward`, {
        method: 'POST', headers: SUPABASE_HEADERS,
        body: JSON.stringify(redeemBody),
      });
      const json = await res.json();
      if (json.success === false || json.error) {
        const debugSuffix = json.current_points !== undefined
          ? ` — backend sees balance:${json.current_points} cost:${json.required_points}`
          : '';
        setRedeemError((json.error || 'Redemption failed. Please try again.') + debugSuffix);
        return;
      }
      code = json.discount_code || json.code || json.voucher_code || null;
      // Optimistic update: mark as claimed immediately so "✓ Claimed" shows
      // without waiting for the async refetch to complete.
      const claimKey = type === 'partner' ? (item.rewardId || item.id) : item.id;
      setOptimisticClaimed(prev => ({ ...prev, [claimKey]: { code: code || item.code || null } }));
      data.refetch('member_rewards');
      data.refetch('wallet');
      data.refetch('customer_session');
    } catch (e) {
      setRedeemError('Could not connect. Please check your connection and try again.');
      return;
    } finally {
      setRedeeming(false);
    }

    setVoucherItem({
      code: code || item.code || null,
      title: item.title,
      brandName: item.brandName || null,
      brandUrl: item.brandUrl || null,
      isPartner: type === 'partner',
      isFreeProduct: type === 'free',
      accentColor: TYPE_META[type].textColorGetter(config.accentColor),
      discountValue: item.discountValue,
    });
  }, [customer, shopDomain, data, config.accentColor, redeeming, existingCodes, existingBrandCodes, optimisticClaimed]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.surface }}>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px' }}>

        {/* Title + balance */}
        <div style={{ fontSize: 22, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>
          Rewards
        </div>
        <div style={{ fontSize: 13, color: tokens.textMuted, marginBottom: 12 }}>
          You have <strong style={{ color: tokens.text }}>{fmtPts(customer.pointsBalance)} {config.pointsAbbrev || 'pts'}</strong> to spend.
        </div>

        {/* Wallet entry strip */}
        {activeVouchers > 0 && (
          <button
            onClick={() => setTab('wallet')}
            style={{
              width: '100%', textAlign: 'left',
              background: 'linear-gradient(135deg, #1e1b4b, #312e81)',
              color: '#fff', borderRadius: tokens.radiusLg,
              padding: '14px 16px', marginBottom: 16, border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 22 }}>💼</span>
              <span style={{ fontSize: 13 }}>
                <strong style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                  Your wallet
                </strong>
                {activeVouchers} unused voucher{activeVouchers !== 1 ? 's' : ''}
              </span>
            </div>
            <span style={{ fontSize: 16 }}>→</span>
          </button>
        )}

        {/* Filter chips */}
        {visibleFilters.length > 2 && (
          <div style={{
            display: 'flex', gap: 6, marginBottom: 16,
            overflowX: 'auto', paddingBottom: 4,
          }}>
            {visibleFilters.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  border: filter === f.id ? `1px solid ${config.accentColor}` : `1px solid ${tokens.border}`,
                  background: filter === f.id ? config.accentColor : tokens.surface,
                  color: filter === f.id ? '#fff' : tokens.text,
                  padding: '6px 12px', borderRadius: 999,
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* Error toast */}
        {redeemError && (
          <div style={{
            background: tokens.dangerSoft, border: `1px solid #fecaca`,
            borderRadius: tokens.radiusMd, padding: '8px 12px',
            fontSize: 12, color: '#dc2626', marginBottom: 12,
            display: 'flex', justifyContent: 'space-between', gap: 8,
          }}>
            <span>⚠ {redeemError}</span>
            <button
              onClick={() => setRedeemError(null)}
              style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', fontSize: 14 }}
            >×</button>
          </div>
        )}

        {/* Free product banner (only when filter shows it) */}
        {(filter === 'all' || filter === 'free') && counts.free > 0 && (
          <div style={{
            background: tokens.warningSoft, border: `1px solid #fde68a`,
            borderRadius: tokens.radiusMd, padding: '10px 14px',
            fontSize: 12, color: tokens.warningText, marginBottom: 12,
          }}>
            🛒 Marketplace items get added to your cart at ₹0 via Shopify
          </div>
        )}

        {/* Reward list */}
        {filteredItems.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '40px 0',
            border: `1px dashed ${tokens.border}`, borderRadius: tokens.radiusMd,
          }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>🎁</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 6 }}>
              No rewards in this category
            </div>
            <div style={{ fontSize: 12, color: tokens.textMuted }}>
              {filter === 'all'
                ? 'Keep earning — rewards will appear here soon.'
                : 'Try a different filter.'}
            </div>
          </div>
        ) : filteredItems.map(item => (
          <RewardRow
            key={`${item._type}_${item.id}`}
            item={item}
            config={config}
            balance={customer.pointsBalance || 0}
            redeeming={redeeming}
            onAction={() => handleRedeem(item)}
            existingCode={
              optimisticClaimed[item.rewardId] || optimisticClaimed[item.id] ||
              (item._type === 'partner'
                ? (existingBrandCodes[item.rewardId] || existingBrandCodes[item.id] || existingCodes[item.rewardId] || existingCodes[item.id] || null)
                : (existingCodes[item.id] || null))
            }
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

function RewardRow({ item, config, balance, redeeming, onAction, existingCode }) {
  const canAfford = balance >= item.pointsCost;
  const isClaimed = !!existingCode;
  const [copied, setCopied] = useState(false);
  const meta = TYPE_META[item._type] || TYPE_META.store;
  const typeColor = meta.textColorGetter(config.accentColor);
  const typeBg    = meta.bgGetter(config.accentColor);

  const handleCopy = useCallback(() => {
    const code = existingCode?.code;
    if (!code) return;
    if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
    else {
      const el = document.createElement('textarea');
      el.value = code; el.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(el); el.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [existingCode]);

  const needMore = !isClaimed && !canAfford ? item.pointsCost - balance : 0;

  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center',
      padding: 14, marginBottom: 10,
      border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusLg,
      background: tokens.surface,
      opacity: !isClaimed && !canAfford ? 0.7 : 1,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10,
        background: typeBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, flexShrink: 0,
      }}>
        {meta.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'inline-block',
          fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: 0.5,
          color: typeColor, background: typeBg,
          padding: '2px 8px', borderRadius: 999,
          marginBottom: 4,
        }}>
          {meta.label}
        </span>
        <div style={{
          fontWeight: 600, fontSize: 14, color: tokens.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.title}
        </div>
        {item.brandName && (
          <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 1 }}>
            {item.brandName}
          </div>
        )}
        <div style={{ fontSize: 12, color: tokens.text, fontWeight: 600, marginTop: 4 }}>
          {fmtPts(item.pointsCost)} {config.pointsAbbrev || 'pts'}
          {needMore > 0 && (
            <span style={{ color: tokens.textMuted, fontWeight: 400, marginLeft: 6 }}>
              · need {fmtPts(needMore)} more
            </span>
          )}
        </div>
      </div>
      {isClaimed ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
          <div style={{
            background: tokens.successSoft, border: `1px solid ${tokens.successText}33`,
            borderRadius: tokens.radiusSm, padding: '4px 10px',
            fontSize: 11, fontWeight: 700, color: tokens.successText,
          }}>
            ✓ Claimed
          </div>
          {existingCode.code && (
            <button onClick={handleCopy} style={{
              background: copied ? tokens.successText : tokens.bg,
              color: copied ? '#fff' : tokens.text,
              border: 'none', borderRadius: tokens.radiusSm,
              padding: '3px 8px', fontSize: 10, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'monospace', whiteSpace: 'nowrap',
            }}>
              {copied ? '✓ Copied' : existingCode.code}
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={onAction}
          disabled={!canAfford || redeeming}
          style={{
            background: canAfford ? config.accentColor : tokens.bg,
            color: canAfford ? '#fff' : tokens.textMuted,
            border: 'none', borderRadius: tokens.radiusMd,
            padding: '8px 14px', fontSize: 13, fontWeight: 600,
            cursor: canAfford ? 'pointer' : 'not-allowed',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          {redeeming ? '…' : canAfford ? 'Redeem' : 'Locked'}
        </button>
      )}
    </div>
  );
}

export default MemberRedeem;
