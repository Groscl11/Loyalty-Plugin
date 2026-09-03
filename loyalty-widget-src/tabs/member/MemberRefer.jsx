/**
 * MemberRefer — referral hub with sub-tabs (Refer / Leaderboard).
 *
 * Layout:
 *   1. Sub-tab pill bar (Refer / Leaderboard if enabled)
 *   2. Refer screen: 🎁 hero → value prop → code box → share grid →
 *      stats strip → referrals list
 *   3. Leaderboard: "you are #N" pill → prizes section → ranked list
 *
 * Preserves: prize-edit admin flow, navigator.share fallback, leaderboard
 * data shape.
 */

import React, { useState, useCallback } from 'react';
import { tokens, accentSoft, fmtPts } from '../../utils/tokens.js';
import { SUPABASE_URL, SUPABASE_HEADERS } from '../../utils/supabase.js';

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

function buildShareUrl(channel, url, brandName) {
  const msg = encodeURIComponent(`Shop and save! Use my referral link to ${brandName ? `get rewards from ${brandName}` : 'earn rewards'}: ${url}`);
  if (channel === 'whatsapp') return `https://wa.me/?text=${msg}`;
  if (channel === 'email')    return `mailto:?subject=${encodeURIComponent('Try this rewards link')}&body=${msg}`;
  if (channel === 'sms')      return `sms:?body=${msg}`;
  return url;
}

const MemberRefer = React.memo(function MemberRefer({ data, config }) {
  const [subTab, setSubTab]         = useState('refer');
  const [copied, setCopied]         = useState(false);
  const [editPrizes, setEditPrizes] = useState(false);
  const [prizes, setPrizes]         = useState(
    config.prizes || [
      { rank: '🥇 1st Place', desc: '' },
      { rank: '🥈 2nd Place', desc: '' },
      { rank: '🥉 3rd Place', desc: '' },
    ]
  );
  const [saving, setSaving] = useState(false);

  const customer    = data.customer    || {};
  const referrals   = data.referrals   || {};
  const leaderboard = data.leaderboard || [];
  const isAdmin     = data.merchant?.isAdmin || false;
  const brandName   = data.merchant?.storeName || 'us';

  const referralCode = customer.referralCode || '';
  const referralUrl  = customer.referralUrl  || '';
  const myEntry      = leaderboard.find(r => r.isCurrentUser);

  // Find referral earn rule for the value prop ("Give X, earn Y pts")
  const referRule = (data.earnRules || data.merchant?.earnRules || []).find(r =>
    r.rule_type === 'referral' || /refer/i.test(r.name || r.label || '')
  );
  const ptsLabel = referRule?.points_reward
    ? `earn ${fmtPts(referRule.points_reward)} ${config.pointsAbbrev || 'pts'}`
    : `earn rewards`;

  const handleCopy = useCallback(() => {
    if (!referralCode && !referralUrl) return;
    copyText(referralCode || referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [referralCode, referralUrl]);

  const handleSavePrizes = useCallback(async () => {
    setSaving(true);
    try {
      const shopDomain = (typeof window !== 'undefined' && (window.Shopify?.shop || window.location?.hostname)) || '';
      await fetch(`${SUPABASE_URL}/functions/v1/update-merchant-config`, {
        method: 'PATCH', headers: SUPABASE_HEADERS,
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.surface }}>

      {/* Sub-tab pill bar (only if leaderboard enabled) */}
      {config.showLeaderboard && (
        <div style={{
          display: 'flex', gap: 6,
          padding: '10px 16px 8px',
          borderBottom: `1px solid ${tokens.borderSoft}`,
        }}>
          {[
            { id: 'refer',       label: 'Refer' },
            { id: 'leaderboard', label: 'Leaderboard' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              style={{
                border: subTab === t.id ? `1px solid ${config.accentColor}` : `1px solid ${tokens.border}`,
                background: subTab === t.id ? config.accentColor : tokens.surface,
                color: subTab === t.id ? '#fff' : tokens.text,
                padding: '6px 14px', borderRadius: 999,
                fontSize: 12, fontWeight: 500, cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 24px' }}>

        {/* ── REFER ────────────────────────────────────────────────── */}
        {subTab === 'refer' && (
          <>
            {/* Hero */}
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 56, marginBottom: 8 }}>🎁</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>
                Refer a friend, {ptsLabel}
              </div>
              <div style={{ fontSize: 13, color: tokens.textMuted }}>
                on every successful referral
              </div>
            </div>

            {/* Code box */}
            <div style={{
              border: `2px dashed ${tokens.border}`,
              borderRadius: tokens.radiusLg,
              padding: '14px 16px', background: tokens.bg,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 16,
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 11, color: tokens.textMuted,
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  marginBottom: 4,
                }}>
                  Your code
                </div>
                <div style={{
                  fontFamily: 'SF Mono, Monaco, Menlo, monospace',
                  fontSize: 22, fontWeight: 700, letterSpacing: 2,
                  color: tokens.text,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {referralCode || '—'}
                </div>
              </div>
              <button
                onClick={handleCopy}
                disabled={!referralCode && !referralUrl}
                style={{
                  background: copied ? tokens.successText : tokens.surface,
                  color: copied ? '#fff' : tokens.text,
                  border: `1px solid ${copied ? tokens.successText : tokens.border}`,
                  padding: '8px 12px', borderRadius: tokens.radiusSm,
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  whiteSpace: 'nowrap', marginLeft: 12, flexShrink: 0,
                }}
              >
                {copied ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>

            {/* Share grid */}
            {referralUrl && (
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                gap: 8, marginBottom: 20,
              }}>
                {['whatsapp', 'email', 'sms'].map(channel => (
                  <a
                    key={channel}
                    href={buildShareUrl(channel, referralUrl, brandName)}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      padding: 12, borderRadius: tokens.radiusMd,
                      border: `1px solid ${tokens.border}`,
                      background: tokens.surface, cursor: 'pointer',
                      fontSize: 12, fontWeight: 500, color: tokens.text,
                      textDecoration: 'none', textAlign: 'center',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 22 }}>
                      {channel === 'whatsapp' && '📱'}
                      {channel === 'email'    && '📧'}
                      {channel === 'sms'      && '💬'}
                    </span>
                    {channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'Email'}
                  </a>
                ))}
              </div>
            )}

            {/* Stats strip */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8, marginBottom: 20,
            }}>
              {[
                { label: 'Invited',   value: referrals.totalReferred  || 0 },
                { label: 'Purchased', value: referrals.totalPurchased || 0 },
                { label: 'Earned',    value: fmtPts(referrals.totalPtsEarned || 0) },
              ].map(s => (
                <div key={s.label} style={{
                  background: tokens.bg, borderRadius: tokens.radiusMd,
                  padding: 10, textAlign: 'center',
                }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: tokens.text }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 2 }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Referrals list */}
            {(referrals.list || []).length > 0 && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: tokens.textMuted,
                  marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  Your referrals · {referrals.list.length}
                </div>
                {referrals.list.map((r, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: i < referrals.list.length - 1 ? `1px solid ${tokens.border}` : 'none',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      {r.ptsEarned > 0 ? (
                        <span style={{
                          color: tokens.successText, fontWeight: 700, fontSize: 13,
                          background: tokens.successSoft,
                          padding: '2px 8px', borderRadius: 999,
                          minWidth: 48, textAlign: 'center',
                        }}>
                          +{fmtPts(r.ptsEarned)}
                        </span>
                      ) : (
                        <span style={{
                          color: tokens.warningText, fontWeight: 700, fontSize: 13,
                          background: tokens.warningSoft,
                          padding: '2px 8px', borderRadius: 999,
                          minWidth: 48, textAlign: 'center',
                        }}>
                          ⏳
                        </span>
                      )}
                      <span style={{
                        fontSize: 13, color: tokens.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {r.name || r.email || 'Friend'}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: tokens.textMuted }}>
                      {r.status || 'Pending'}
                    </span>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ── LEADERBOARD ──────────────────────────────────────────── */}
        {subTab === 'leaderboard' && config.showLeaderboard && (
          <>
            {myEntry && (
              <div style={{
                background: accentSoft(config.accentColor),
                border: `1px solid ${config.accentColor}30`,
                borderRadius: tokens.radiusLg,
                padding: '14px 16px', marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, color: config.accentColor, fontWeight: 700, marginBottom: 4 }}>
                  You are #{myEntry.rank} on the leaderboard
                </div>
                <div style={{ fontSize: 12, color: tokens.textMuted }}>
                  {fmtPts(myEntry.points)} {config.pointsAbbrev || 'pts'} total
                  {myEntry.rank > 1 && myEntry.gapToNext
                    ? ` · ${fmtPts(myEntry.gapToNext)} from #${myEntry.rank - 1}`
                    : null}
                </div>
              </div>
            )}

            {prizes.some(p => p.desc) && (
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: tokens.textMuted,
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>
                    Prizes
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => setEditPrizes(e => !e)}
                      style={{
                        fontSize: 11, color: config.accentColor,
                        border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      {editPrizes ? 'Cancel' : '✏️ Edit'}
                    </button>
                  )}
                </div>
                {editPrizes ? (
                  <>
                    {prizes.map((p, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: tokens.textMuted, marginBottom: 3 }}>
                          {p.rank}
                        </div>
                        <input
                          type="text"
                          value={p.desc}
                          onChange={e => {
                            const next = prizes.map((x, j) => j === i ? { ...x, desc: e.target.value } : x);
                            setPrizes(next);
                          }}
                          style={{
                            width: '100%',
                            border: `1px solid ${tokens.border}`,
                            borderRadius: tokens.radiusMd,
                            padding: '8px 12px', fontSize: 12,
                            color: tokens.text, boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    ))}
                    <button
                      onClick={handleSavePrizes}
                      disabled={saving}
                      style={{
                        background: config.accentColor, color: '#fff',
                        border: 'none', borderRadius: tokens.radiusMd,
                        padding: '8px 20px', fontSize: 12, fontWeight: 600,
                        cursor: saving ? 'not-allowed' : 'pointer', marginTop: 4,
                      }}
                    >
                      {saving ? 'Saving…' : 'Save Prizes'}
                    </button>
                  </>
                ) : (
                  prizes.filter(p => p.desc).map((p, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px',
                      background: tokens.warningSoft, border: `1px solid #fde68a`,
                      borderRadius: tokens.radiusMd, marginBottom: 7,
                    }}>
                      <div style={{ fontSize: 18 }}>{['🥇','🥈','🥉'][i]}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12, color: tokens.warningText }}>
                          {p.rank}
                        </div>
                        <div style={{ fontSize: 12, color: tokens.text }}>{p.desc}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            <div style={{
              fontSize: 11, fontWeight: 700, color: tokens.textMuted,
              marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              Top referrers
            </div>
            {leaderboard.map((entry, i) => {
              const isSelf = entry.isCurrentUser;
              return (
                <div key={entry.userId || i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  background: isSelf ? accentSoft(config.accentColor) : tokens.surface,
                  border: isSelf ? `1px solid ${config.accentColor}30` : `1px solid ${tokens.border}`,
                  borderRadius: tokens.radiusMd, marginBottom: 6,
                }}>
                  <div style={{
                    width: 28, textAlign: 'center',
                    fontSize: i < 3 ? 16 : 12, fontWeight: 700,
                    color: tokens.text,
                  }}>
                    {i < 3 ? ['🥇','🥈','🥉'][i] : `#${entry.rank}`}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: isSelf ? 700 : 500, fontSize: 13,
                      color: isSelf ? config.accentColor : tokens.text,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {entry.displayName} {isSelf ? '(you)' : ''}
                    </div>
                  </div>
                  <div style={{
                    fontWeight: 700, fontSize: 13,
                    color: isSelf ? config.accentColor : tokens.text,
                  }}>
                    {typeof entry.referrals === 'number' ? entry.referrals : 0} refs
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

export default MemberRefer;
