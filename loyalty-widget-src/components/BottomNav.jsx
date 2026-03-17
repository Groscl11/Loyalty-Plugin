/**
 * BottomNav — GoSelf Loyalty Widget V6
 * 5-tab navigation bar. "⋯ More" cycles through Milestones → History → Profile.
 */

import React, { useState, useCallback } from 'react';

const MORE_TABS = ['milestones', 'history', 'profile'];

const NAV_ICONS = {
  home:       '🏠',
  earn:       '🪙',
  redeem:     '🎁',
  refer:      '📣',
  wallet:     '💳',
  milestones: '🏆',
  history:    '📜',
  profile:    '👤',
};

const NAV_LABELS = {
  home:       'Home',
  earn:       'Earn',
  redeem:     'Redeem',
  refer:      'Refer',
  wallet:     'Wallet',
  milestones: 'Milestones',
  history:    'History',
  profile:    'Profile',
};

const BottomNav = React.memo(function BottomNav({
  activeTab,
  setTab,
  config,
  activeCouponCount,
}) {
  const [moreTabIdx, setMoreTabIdx] = useState(0);

  // Which tabs are visible in the primary bar
  const primaryTabs = ['home', 'earn', 'redeem', 'wallet'];
  if (config.showMilestones) primaryTabs.push('milestones');
  if (config.showReferTab)   primaryTabs.push('refer');

  // Compact mode: icon-only when many tabs are visible
  const compactMode = primaryTabs.length >= 5;

  // Filter MORE tabs — only history & profile go here now
  const availableMoreTabs = ['history', 'profile'];

  const moreTab = availableMoreTabs[moreTabIdx % availableMoreTabs.length] || 'history';
  const isMobileMoreActive = availableMoreTabs.includes(activeTab);

  const handleMoreClick = useCallback(() => {
    const next = availableMoreTabs[moreTabIdx % availableMoreTabs.length];
    if (activeTab === next) {
      // Cycle to next
      const newIdx = (moreTabIdx + 1) % availableMoreTabs.length;
      setMoreTabIdx(newIdx);
      setTab(availableMoreTabs[newIdx]);
    } else {
      setTab(next);
    }
  }, [activeTab, moreTabIdx, availableMoreTabs, setTab]);

  const allTabs = [...primaryTabs, '__more__'];

  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        borderTop: '1px solid #f3f4f6',
        backgroundColor: '#ffffff',
      }}
      role="tablist"
      aria-label="Navigation"
    >
      {allTabs.map(tab => {
        if (tab === '__more__') {
          const isActive = isMobileMoreActive;
          return (
            <NavTab
              key="more"
              label={isMobileMoreActive ? NAV_LABELS[activeTab] : '⋯ More'}
              icon={isMobileMoreActive ? NAV_ICONS[activeTab] : '⋯'}
              isActive={isActive}
              accentColor={config.accentColor}
              badge={activeTab === 'wallet' ? activeCouponCount : 0}
              compact={compactMode}
              onClick={handleMoreClick}
            />
          );
        }

        const isActive = activeTab === tab;
        return (
          <NavTab
            key={tab}
            label={NAV_LABELS[tab]}
            icon={NAV_ICONS[tab]}
            isActive={isActive}
            accentColor={config.accentColor}
            badge={tab === 'wallet' ? activeCouponCount : 0}
            compact={compactMode}
            onClick={() => setTab(tab)}
          />
        );
      })}
    </div>
  );
});

function NavTab({ label, icon, isActive, accentColor, badge, compact, onClick }) {
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
        padding: compact ? '6px 1px 6px' : '6px 2px 7px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        borderTop: isActive ? `2px solid ${accentColor}` : '2px solid transparent',
        color: isActive ? accentColor : '#6b7280',
        fontSize: 10,
        fontWeight: isActive ? 600 : 400,
        position: 'relative',
        gap: 2,
      }}
    >
      <span style={{ fontSize: compact ? 15 : 18, lineHeight: 1 }}>{icon}</span>
      {!compact && <span style={{ fontSize: 10 }}>{label}</span>}
      {badge > 0 && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: '50%',
            transform: 'translateX(8px)',
            background: '#ef4444',
            color: '#fff',
            borderRadius: '50%',
            width: 16,
            height: 16,
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
