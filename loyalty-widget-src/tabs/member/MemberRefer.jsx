/**
 * MemberRefer — GoSelf Loyalty Widget V6
 * Sub-tabs: Refer | Leaderboard
 * Leaderboard + prize editor (admin-only PATCH).
 */

import React, { useState, useCallback } from 'react';
import { formatPoints } from '../../utils/formatPoints.js';
import { SUPABASE_URL, SUPABASE_HEADERS } from '../../utils/supabase.js';

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

const MemberRefer = React.memo(function MemberRefer({ data, config }) {
  const [subTab, setSubTab]     = useState('refer');
  const [copied, setCopied]     = useState(false);
  const [editPrizes, setEditPrizes] = useState(false);
  const [prizes, setPrizes]     = useState(
    config.prizes || [
      { rank: '🥇 1st Place', desc: '' },
      { rank: '🥈 2nd Place', desc: '' },
      { rank: '🥉 3rd Place', desc: '' },
    ]
  );
  const [saving, setSaving] = useState(false);

  const customer  = data.customer  || {};
  const referrals = data.referrals || {};
  const leaderboard = data.leaderboard || [];
  const isAdmin   = data.merchant?.isAdmin || false;

  const referralUrl = customer.referralUrl || '';
  const myEntry     = leaderboard.find(r => r.isCurrentUser);

  const handleCopy = useCallback(() => {
    if (!referralUrl) return;
    copyText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [referralUrl]);

  const handleShare = useCallback(() => {
    if (navigator.share) {
      navigator.share({
        title: 'Join me on ' + (data.merchant?.storeName || 'the store'),
        text:  'Use my referral link to earn rewards!',
        url:   referralUrl,
      }).catch(() => { /* user cancelled */ });
    } else {
      handleCopy();
    }
  }, [referralUrl, data.merchant, handleCopy]);

  const handleSavePrizes = useCallback(async () => {
    setSaving(true);
    try {
      const shopDomain = (typeof window !== 'undefined' && (window.Shopify?.shop || window.location?.hostname)) || '';
      await fetch(`${SUPABASE_URL}/functions/v1/update-merchant-config`, {
        method: 'PATCH',
        headers: SUPABASE_HEADERS,
        body: JSON.stringify({ shop_domain: shopDomain, prizes }),
      });
      setEditPrizes(false);
    } catch (e) {
      console.warn('[GoSelf] update-merchant-config failed:', e.message);
      setEditPrizes(false);
    } finally {
      setSaving(false);
    }
  }, [prizes]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', padding: '0 16px' }}>
        {['refer', 'leaderboard'].map(t => {
          if (t === 'leaderboard' && !config.showLeaderboard) return null;
          const label = t === 'refer' ? '🔗 Refer' : '🏆 Leaderboard';
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

        {/* ── REFER sub-tab ── */}
        {subTab === 'refer' && (
          <>
            {/* Stats row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'Referred',   value: referrals.totalReferred || 0 },
                { label: 'Purchased',  value: referrals.totalPurchased || 0 },
                { label: 'Pts Earned', value: formatPoints(referrals.totalPtsEarned || 0, config) },
              ].map(s => (
                <div
                  key={s.label}
                  style={{
                    flex: 1,
                    background: `${config.accentColor}0d`,
                    borderRadius: 10,
                    padding: '10px 6px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14, color: config.accentColor }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Referral link */}
            <div style={{ background: '#f9fafb', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6, fontWeight: 600 }}>
                YOUR REFERRAL LINK
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: '#374151',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  padding: '7px 10px',
                  marginBottom: 10,
                }}
              >
                {referralUrl || 'Loading…'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleCopy}
                  style={{
                    flex: 1,
                    background: copied ? '#d1fae5' : config.accentColor,
                    color: copied ? '#065f46' : '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '9px 0',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                >
                  {copied ? '✓ Copied!' : '📋 Copy Link'}
                </button>
                <button
                  onClick={handleShare}
                  style={{
                    flex: 1,
                    background: '#f3f4f6',
                    color: '#374151',
                    border: 'none',
                    borderRadius: 8,
                    padding: '9px 0',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🔗 Share
                </button>
              </div>
            </div>

            {/* Referral list */}
            {(referrals.list || []).length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>
                  RECENT REFERRALS
                </div>
                {(referrals.list || []).map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 12px',
                      background: '#fff',
                      border: '1px solid #f3f4f6',
                      borderRadius: 10,
                      marginBottom: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{r.name || r.email}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{r.status}</div>
                    </div>
                    {r.ptsEarned > 0 && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: config.accentColor }}>
                        +{formatPoints(r.ptsEarned, config)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── LEADERBOARD sub-tab ── */}
        {subTab === 'leaderboard' && config.showLeaderboard && (
          <>
            {/* My rank motivator */}
            {myEntry && (
              <div
                style={{
                  background: `${config.accentColor}12`,
                  border: `1px solid ${config.accentColor}30`,
                  borderRadius: 12,
                  padding: '12px 14px',
                  marginBottom: 14,
                }}
              >
                <div style={{ fontSize: 12, color: config.accentColor, fontWeight: 700 }}>
                  You are #{myEntry.rank} on the leaderboard
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  {formatPoints(myEntry.points, config)} total
                  {myEntry.rank > 1 && myEntry.gapToNext
                    ? ` · ${formatPoints(myEntry.gapToNext, config)} from #${myEntry.rank - 1}`
                    : null}
                </div>
              </div>
            )}

            {/* Prizes */}
            {prizes.some(p => p.desc) && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>PRIZES</div>
                  {isAdmin && (
                    <button
                      onClick={() => setEditPrizes(e => !e)}
                      style={{ fontSize: 11, color: config.accentColor, border: 'none', background: 'transparent', cursor: 'pointer' }}
                    >
                      {editPrizes ? 'Cancel' : '✏️ Edit Prizes'}
                    </button>
                  )}
                </div>
                {editPrizes ? (
                  <>
                    {prizes.map((p, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>{p.rank}</div>
                        <input
                          type="text"
                          value={p.desc}
                          onChange={e => {
                            const next = prizes.map((x, j) => j === i ? { ...x, desc: e.target.value } : x);
                            setPrizes(next);
                          }}
                          style={{
                            width: '100%',
                            border: '1px solid #d1d5db',
                            borderRadius: 7,
                            padding: '7px 10px',
                            fontSize: 12,
                            color: '#111827',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    ))}
                    <button
                      onClick={handleSavePrizes}
                      disabled={saving}
                      style={{
                        background: config.accentColor,
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '8px 20px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: saving ? 'not-allowed' : 'pointer',
                        marginTop: 4,
                      }}
                    >
                      {saving ? 'Saving…' : 'Save Prizes'}
                    </button>
                  </>
                ) : (
                  prizes.filter(p => p.desc).map((p, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '9px 12px',
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: 10,
                        marginBottom: 7,
                      }}
                    >
                      <div style={{ fontSize: 16, flexShrink: 0 }}>{['🥇','🥈','🥉'][i]}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12, color: '#92400e' }}>{p.rank}</div>
                        <div style={{ fontSize: 12, color: '#374151' }}>{p.desc}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Leaderboard table */}
            <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, marginBottom: 8 }}>
              TOP REFERRERS
            </div>
            {leaderboard.map((entry, i) => {
              const isSelf = entry.isCurrentUser;
              return (
                <div
                  key={entry.userId || i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    background: isSelf ? `${config.accentColor}10` : (i % 2 === 0 ? '#fff' : '#f9fafb'),
                    borderRadius: 10,
                    marginBottom: 4,
                    border: isSelf ? `1px solid ${config.accentColor}30` : '1px solid transparent',
                  }}
                >
                  <div style={{ width: 22, textAlign: 'center', fontSize: i < 3 ? 16 : 12, fontWeight: 700, color: '#374151' }}>
                    {i < 3 ? ['🥇','🥈','🥉'][i] : `#${entry.rank}`}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: isSelf ? 700 : 500,
                        fontSize: 13,
                        color: isSelf ? config.accentColor : '#111827',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.displayName} {isSelf ? '(you)' : ''}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: isSelf ? config.accentColor : '#374151' }}>
                    {loadNumber(entry.referrals)} refs
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
});

function loadNumber(n) {
  return typeof n === 'number' ? n : 0;
}

export default MemberRefer;
