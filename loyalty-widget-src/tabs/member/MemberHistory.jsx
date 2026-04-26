/**
 * MemberHistory — GoSelf Loyalty Widget V6
 * 3-col stats header, filter buttons, transaction list.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { formatPoints } from '../../utils/formatPoints.js';

const FILTERS = ['all', 'earned', 'redeemed'];

const MemberHistory = React.memo(function MemberHistory({ data, config }) {
  const [filter, setFilter]       = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const history  = data.history  || [];
  const customer = data.customer || {};

  // Force-fresh on every mount so transactions from recent orders appear immediately
  useEffect(() => {
    try {
      sessionStorage.removeItem('goself:customer_session');
      sessionStorage.removeItem('goself:customer_session_v2');
      sessionStorage.removeItem('goself:history');
    } catch (_) {}
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    data.refetch('customer_session');
    setTimeout(() => setRefreshing(false), 2000);
  }, [data]);

  const totalEarned   = customer.lifetimeEarned
                      || history.filter(h => h.delta > 0).reduce((s, h) => s + h.delta, 0);
  const totalRedeemed = customer.lifetimeRedeemed
                      || history.filter(h => h.delta < 0).reduce((s, h) => s + Math.abs(h.delta), 0);

  const filtered = history.filter(h => {
    if (filter === 'earned')   return h.delta > 0;
    if (filter === 'redeemed') return h.delta < 0;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Stats header */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #f3f4f6' }}>
        {[
          { label: 'Total Earned',   value: formatPoints(totalEarned,   config) },
          { label: 'Redeemed',       value: formatPoints(totalRedeemed, config) },
          { label: 'Balance',        value: formatPoints(customer.pointsBalance || 0, config) },
        ].map((s, i) => (
          <div
            key={s.label}
            style={{
              flex: 1,
              padding: '10px 4px',
              textAlign: 'center',
              borderRight: i < 2 ? '1px solid #f3f4f6' : 'none',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 12, color: '#111827' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter + Refresh row */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', gap: 8, borderBottom: '1px solid #f3f4f6' }}>
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 12px',
              border: filter === f ? `1px solid ${config.accentColor}` : '1px solid #e5e7eb',
              borderRadius: 99,
              background: filter === f ? `${config.accentColor}12` : '#fff',
              color: filter === f ? config.accentColor : '#6b7280',
              fontWeight: filter === f ? 600 : 400,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {f === 'all' ? 'All' : f === 'earned' ? '↑ Earned' : '↓ Redeemed'}
          </button>
        ))}
        {/* Refresh button — lets user see transactions from very recent orders */}
        <button
          onClick={handleRefresh}
          title="Refresh transactions"
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'transparent',
            color: refreshing ? config.accentColor : '#9ca3af',
            fontSize: 14,
            cursor: 'pointer',
            padding: '4px 6px',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            animation: refreshing ? 'gsSpin 0.8s linear infinite' : 'none',
          }}
          aria-label="Refresh transactions"
        >
          ↻
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 24px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, paddingTop: 40 }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>{filter === 'all' ? '📋' : filter === 'earned' ? '⬆' : '⬇'}</div>
            <div style={{ fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              {filter === 'all' ? 'No transactions yet' : filter === 'earned' ? 'No earned transactions' : 'No redeemed transactions'}
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5 }}>
              {filter === 'all'
                ? 'Transactions appear here within a few minutes after each order. Tap ↻ to refresh.'
                : 'Try switching to "All" to see all activity.'}
            </div>
          </div>
        ) : (
          filtered.map((tx, i) => {
            const isPositive = tx.delta > 0;
            return (
              <div
                key={tx.id || i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: i < filtered.length - 1 ? '1px solid #f9fafb' : 'none',
                }}
              >
                {/* Icon bubble */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: isPositive ? '#dcfce7' : '#fee2e2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    flexShrink: 0,
                  }}
                >
                  {tx.icon || (isPositive ? '⬆' : '⬇')}
                </div>

                {/* Label + date */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      fontSize: 13,
                      color: '#111827',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tx.label || (isPositive ? 'Points Earned' : 'Points Redeemed')}
                  </div>
                  {tx.date && (
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{tx.date}</div>
                  )}
                </div>

                {/* Points change */}
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: isPositive ? '#16a34a' : '#dc2626',
                    flexShrink: 0,
                  }}
                >
                  {isPositive ? '+' : ''}{formatPoints(tx.delta, config)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

export default MemberHistory;
