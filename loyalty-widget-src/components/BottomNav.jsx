/**
 * BottomNav — 5-tab fixed bar (Home / Earn / Redeem / Refer / Profile).
 *
 * Wallet, Milestones, History no longer live in the primary nav — they're
 * surfaced inside the Profile hub.  Active-coupon count is shown as a badge
 * on the Profile tab instead of Wallet.
 *
 * The Refer tab can be hidden via merchant config (config.showReferTab),
 * collapsing to a 4-tab layout.
 */

import React from 'react';
import { tokens } from '../utils/tokens.js';

const PRIMARY_TABS = [
  { id: 'home',    icon: '🏠', label: 'Home'    },
  { id: 'earn',    icon: '🪙', label: 'Earn'    },
  { id: 'redeem',  icon: '🎁', label: 'Redeem'  },
  { id: 'refer',   icon: '📣', label: 'Refer'   },
  { id: 'profile', icon: '👤', label: 'Profile' },
];

// Sub-pages of Profile — when one of these is the active route we still
// highlight the Profile tab in the nav.
const PROFILE_SUBPAGES = new Set(['wallet', 'milestones', 'history', 'profile']);

const BottomNav = React.memo(function BottomNav({
  activeTab,
  setTab,
  config,
  activeCouponCount,
}) {
  const tabs = PRIMARY_TABS.filter(t => {
    if (t.id === 'earn'  && !config.showEarnTab)  return false;
    if (t.id === 'refer' && !config.showReferTab) return false;
    return true;
  });

  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        borderTop: `1px solid ${tokens.borderSoft}`,
        backgroundColor: tokens.surface,
      }}
      role="tablist"
      aria-label="Navigation"
    >
      {tabs.map(t => {
        const isActive = t.id === activeTab
          || (t.id === 'profile' && PROFILE_SUBPAGES.has(activeTab));
        const showBadge = t.id === 'profile' && activeCouponCount > 0;
        return (
          <NavTab
            key={t.id}
            label={t.label}
            icon={t.icon}
            isActive={isActive}
            accentColor={config.accentColor}
            badge={showBadge ? activeCouponCount : 0}
            onClick={() => setTab(t.id)}
          />
        );
      })}
    </div>
  );
});

function NavTab({ label, icon, isActive, accentColor, badge, onClick }) {
  return (
    <button
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 2px 8px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        borderTop: isActive ? `2px solid ${accentColor}` : '2px solid transparent',
        color: isActive ? accentColor : tokens.textMuted,
        fontSize: 10,
        fontWeight: isActive ? 600 : 500,
        position: 'relative',
        gap: 3,
        transition: 'color 0.15s',
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 10 }}>{label}</span>
      {badge > 0 && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: '50%',
            transform: 'translateX(12px)',
            background: tokens.danger,
            color: '#fff',
            borderRadius: '50%',
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            fontSize: 9,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

export default BottomNav;
