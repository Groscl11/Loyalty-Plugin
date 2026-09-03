/**
 * MemberHistory — transaction ledger (reached from Profile hub or "see all" on Home).
 *
 * Layout: filter pills (All / Earned / Redeemed) + refresh, then transaction
 * list using the new activity-row pattern from MemberHome.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { tokens, fmtPts } from '../../utils/tokens.js';

const FILTERS = ['all', 'earned', 'redeemed'];

function formatRelativeDate(d) {
  if (!d) return '';
  try {
    const date = new Date(d);
    const diffMs = Date.now() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 1)   return 'today';
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7)   return `${diffDays} days ago`;
    if (diffDays < 14)  return '1 week ago';
    if (diffDays < 30)  return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  } catch { return d; }
}

const MemberHistory = React.memo(function MemberHistory({ data, config, setTab }) {
  const [filter, setFilter]         = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const history  = data.history  || [];
  const customer = data.customer || {};

  useEffect(() => {
    try {
      sessionStorage.removeItem('goself:customer_session');
      sessionStorage.removeItem('goself:customer_session_v2');
      sessionStorage.removeItem('goself:history');
    } catch {}
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    data.refetch('customer_session');
    setTimeout(() => setRefreshing(false), 2000);
  }, [data]);

  const totalEarned   = customer.lifetimeEarned   || history.filter(h => h.delta > 0).reduce((s, h) => s + h.delta, 0);
  const totalRedeemed = customer.lifetimeRedeemed || history.filter(h => h.delta < 0).reduce((s, h) => s + Math.abs(h.delta), 0);

  const filtered = history.filter(h => {
    if (filter === 'earned')   return h.delta > 0;
    if (filter === 'redeemed') return h.delta < 0;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.surface }}>

      {/* Back strip */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px',
        background: tokens.bg,
        borderBottom: `1px solid ${tokens.borderSoft}`,
      }}>
        <button
          onClick={() => setTab && setTab('profile')}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            padding: '4px 8px', borderRadius: tokens.radiusSm,
            color: tokens.text, fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >← Profile</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px' }}>

        <div style={{ fontSize: 22, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>
          Activity
        </div>
        <div style={{ fontSize: 13, color: tokens.textMuted, marginBottom: 16 }}>
          {fmtPts(totalEarned)} earned · {fmtPts(totalRedeemed)} redeemed · balance {fmtPts(customer.pointsBalance || 0)} {config.pointsAbbrev || 'pts'}
        </div>

        {/* Filter + refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                border: filter === f ? `1px solid ${config.accentColor}` : `1px solid ${tokens.border}`,
                background: filter === f ? config.accentColor : tokens.surface,
                color: filter === f ? '#fff' : tokens.text,
                padding: '6px 12px', borderRadius: 999,
                fontSize: 12, fontWeight: 500, cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {f === 'all' ? 'All' : f === 'earned' ? '↑ Earned' : '↓ Redeemed'}
            </button>
          ))}
          <button
            onClick={handleRefresh}
            title="Refresh transactions"
            style={{
              marginLeft: 'auto',
              border: 'none', background: 'transparent',
              color: refreshing ? config.accentColor : tokens.textMuted,
              fontSize: 16, cursor: 'pointer', padding: '4px 8px',
              animation: refreshing ? 'gsSpin 0.8s linear infinite' : 'none',
            }}
            aria-label="Refresh transactions"
          >
            ↻
          </button>
          <style>{`@keyframes gsSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
        </div>

        {filtered.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '40px 0',
            border: `1px dashed ${tokens.border}`, borderRadius: tokens.radiusMd,
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>
              {filter === 'all' ? '📋' : filter === 'earned' ? '⬆' : '⬇'}
            </div>
            <div style={{ fontWeight: 600, color: tokens.text, marginBottom: 4 }}>
              {filter === 'all' ? 'No transactions yet'
                : filter === 'earned' ? 'No earned transactions'
                : 'No redeemed transactions'}
            </div>
            <div style={{ fontSize: 12, color: tokens.textMuted, lineHeight: 1.5 }}>
              {filter === 'all'
                ? 'Transactions appear here within a few minutes of each order. Tap ↻ to refresh.'
                : 'Switch to "All" to see all activity.'}
            </div>
          </div>
        ) : (
          filtered.map((tx, i) => {
            const isPositive = tx.delta > 0;
            return (
              <div key={tx.id || i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0',
                borderBottom: i < filtered.length - 1 ? `1px solid ${tokens.border}` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span style={{
                    color: isPositive ? tokens.successText : tokens.danger,
                    fontWeight: 700, fontSize: 13,
                    background: isPositive ? tokens.successSoft : tokens.dangerSoft,
                    padding: '2px 8px', borderRadius: 999,
                    minWidth: 56, textAlign: 'center', flexShrink: 0,
                  }}>
                    {isPositive ? '+' : ''}{fmtPts(tx.delta)}
                  </span>
                  <span style={{
                    fontSize: 13, color: tokens.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {tx.label || (isPositive ? 'Points earned' : 'Points redeemed')}
                  </span>
                </div>
                {tx.date && (
                  <span style={{
                    fontSize: 11, color: tokens.textMuted,
                    flexShrink: 0, marginLeft: 8,
                  }}>
                    {formatRelativeDate(tx.date)}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

export default MemberHistory;
