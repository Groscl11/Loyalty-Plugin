/**
 * VoucherModal — GoSelf Loyalty Widget V6
 * Code reveal overlay for redeemed rewards.
 * Position: absolute, inside panel content area.
 */

import React, { useState, useCallback } from 'react';

const VoucherModal = React.memo(function VoucherModal({
  item,        // { code, title, brandName, brandUrl, isPartner, isFreeProduct, accentColor, discountValue }
  config,
  onClose,
}) {
  const [copied, setCopied] = useState(false);

  const color = item.accentColor || config.accentColor;

  const handleCopy = useCallback(async () => {
    if (!item.code) return;
    try {
      await navigator.clipboard.writeText(item.code);
    } catch {
      // Fallback for environments without clipboard API
      const el = document.createElement('textarea');
      el.value = item.code;
      el.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [item.code]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 10,
        }}
        aria-hidden="true"
      />

      {/* Modal card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your reward"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#ffffff',
          borderRadius: '18px 18px 0 0',
          zIndex: 11,
          overflow: 'hidden',
          animation: 'gsSheetsUp 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.1) both',
        }}
      >
        <style>{`
          @keyframes gsSheetsUp {
            from { transform: translateY(100%); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
          }
        `}</style>

        {/* Color top bar */}
        <div style={{ height: 6, background: color }} />

        <div style={{ padding: '20px 20px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#111827' }}>
            {config.rewardNoun} Unlocked!
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 20 }}>
            {item.title}
          </div>

          {/* Free product — no code */}
          {item.isFreeProduct && (
            <div
              style={{
                background: '#f0fdf4',
                border: '1.5px solid #86efac',
                borderRadius: 10,
                padding: '12px 16px',
                fontSize: 13,
                color: '#16a34a',
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              ✓ Added to your cart at ₹0 — no code needed
            </div>
          )}

          {/* Coupon code */}
          {!item.isFreeProduct && item.code && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: '#f9fafb',
                  border: '1.5px dashed #e5e7eb',
                  borderRadius: 10,
                  padding: '10px 14px',
                  marginBottom: 14,
                }}
              >
                <code
                  style={{
                    flex: 1,
                    fontFamily: "'Courier New', monospace",
                    fontSize: 20,
                    fontWeight: 700,
                    color: '#111827',
                    letterSpacing: 2,
                    textAlign: 'center',
                  }}
                >
                  {item.code}
                </code>
                <button
                  onClick={handleCopy}
                  style={{
                    background: color,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              {/* Partner link */}
              {item.isPartner && item.brandUrl && (
                <a
                  href={item.brandUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block',
                    background: color,
                    color: '#fff',
                    borderRadius: 10,
                    padding: '11px 0',
                    fontWeight: 600,
                    fontSize: 13,
                    textDecoration: 'none',
                    marginBottom: 10,
                  }}
                >
                  Visit {item.brandName} → Apply Code
                </a>
              )}
            </>
          )}

          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
            Also saved to your Wallet
          </div>

          <button
            onClick={onClose}
            style={{
              marginTop: 16,
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
});

export default VoucherModal;
