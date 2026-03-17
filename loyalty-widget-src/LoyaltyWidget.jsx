/**
 * LoyaltyWidget — GoSelf Loyalty Widget V6
 * Root component. Owns all state: panel open/close, active tab,
 * guest/member mode, signup gate, survey overlay.
 *
 * Panel layout:
 *   position: fixed, bottom: 72, [side]: 14
 *   width: 312, height: min(76vh, 590px)
 *   display: flex, flexDirection: column
 *   overflow: hidden, borderRadius: 18
 */

import React, { useState, useCallback, useEffect, useRef, startTransition, Suspense } from 'react';

import { useWidgetConfig }  from './hooks/useWidgetConfig.js';
import { useCustomerData }  from './hooks/useCustomerData.js';

import LoyaltyButton     from './LoyaltyButton.jsx';
import PanelHeader       from './components/PanelHeader.jsx';
import GuestBanner       from './components/GuestBanner.jsx';
import BottomNav         from './components/BottomNav.jsx';
import PoweredByBar      from './components/PoweredByBar.jsx';
import SignupGate        from './components/SignupGate.jsx';
import SurveyOverlay     from './components/SurveyOverlay.jsx';

// Guest tabs
const GuestHome        = React.lazy(() => import('./tabs/guest/GuestHome.jsx'));
const GuestEarn        = React.lazy(() => import('./tabs/guest/GuestEarn.jsx'));
const GuestRedeem      = React.lazy(() => import('./tabs/guest/GuestRedeem.jsx'));
const GuestRefer       = React.lazy(() => import('./tabs/guest/GuestRefer.jsx'));
const GuestMilestones  = React.lazy(() => import('./tabs/guest/GuestMilestones.jsx'));
const GuestWallet      = React.lazy(() => import('./tabs/guest/GuestWallet.jsx'));

// Member tabs
const MemberHome       = React.lazy(() => import('./tabs/member/MemberHome.jsx'));
const MemberEarn       = React.lazy(() => import('./tabs/member/MemberEarn.jsx'));
const MemberRedeem     = React.lazy(() => import('./tabs/member/MemberRedeem.jsx'));
const MemberWallet     = React.lazy(() => import('./tabs/member/MemberWallet.jsx'));
const MemberRefer      = React.lazy(() => import('./tabs/member/MemberRefer.jsx'));
const MemberMilestones = React.lazy(() => import('./tabs/member/MemberMilestones.jsx'));
const MemberHistory    = React.lazy(() => import('./tabs/member/MemberHistory.jsx'));
const MemberProfile    = React.lazy(() => import('./tabs/member/MemberProfile.jsx'));

const PANEL_ANIMATION_MS = 220;

export function LoyaltyWidget() {
  const config = useWidgetConfig();
  const data   = useCustomerData();  // no arg — auto-detects email from DOM

  // ── State ──────────────────────────────────────────────────────────────────
  const [panelOpen,   setPanelOpen]   = useState(false);
  const [activeTab,   setActiveTab]   = useState('home');
  const [gateOpen,    setGateOpen]    = useState(false);
  const [gateAction,  setGateAction]  = useState('');
  const [surveyOpen,  setSurveyOpen]  = useState(false);
  // Unmount tab content until first open (lazy mount)
  const [hasOpened,   setHasOpened]   = useState(false);

  const panelRef      = useRef(null);
  const firstFocusRef = useRef(null);

  // isGuest = no Shopify session (no email detected + no customerId from API)
  const isGuest = !data.customer?.email && !data.detectedEmail;

  const activeCouponCount = (data.wallet || []).filter(c => c.status === 'active').length;
  const notifyDot = !isGuest && activeCouponCount > 0;

  // ── Callbacks ──────────────────────────────────────────────────────────────

  const togglePanel = useCallback(() => {
    setPanelOpen(o => {
      const next = !o;
      if (next) setHasOpened(true);
      return next;
    });
  }, []);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  const setTab = useCallback((tabId) => {
    // Use startTransition so tab switch never blocks the main thread
    startTransition(() => setActiveTab(tabId));
  }, []);

  const openGate = useCallback((actionLabel) => {
    setGateAction(actionLabel || '');
    setGateOpen(true);
  }, []);

  const closeGate = useCallback(() => setGateOpen(false), []);

  const handleJoin = useCallback(() => {
    // After guest signups, refresh session
    setGateOpen(false);
    data.refetch('customer_session');
  }, [data]);

  const openSurvey  = useCallback(() => setSurveyOpen(true),  []);
  const closeSurvey = useCallback(() => {
    setSurveyOpen(false);
    // Refetch session after survey to apply points reward
    data.refetch('customer_session');
  }, [data]);

  // ── Keyboard: Escape closes panel ─────────────────────────────────────────

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        closePanel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelOpen, closePanel]);

  // ── Focus trap: move focus into panel when it opens ───────────────────────

  useEffect(() => {
    if (panelOpen && firstFocusRef.current) {
      setTimeout(() => firstFocusRef.current?.focus(), PANEL_ANIMATION_MS);
    }
  }, [panelOpen]);

  // ── Back button: any non-home member tab goes back to home ─────────────────
  const handleBack = useCallback(() => setActiveTab('home'), []);

  // ── Panel position ─────────────────────────────────────────────────────────
  const positionKey = config.widgetPosition === 'left' ? 'left' : 'right';

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ── Override config with backend program branding (e.g. "Gems" instead of "Points") ──
  const effectiveConfig = data.customer?.programPointsName
    ? {
        ...config,
        pointsNoun:   data.customer.programPointsName,
        pointsAbbrev: data.customer.programPointsNameSingular || data.customer.programPointsName,
      }
    : config;

  // ── Render active tab content ──────────────────────────────────────────────

  const sharedGuestProps   = { data, config: effectiveConfig, setTab, onGate: openGate };
  const sharedMemberProps  = { data, config: effectiveConfig, setTab, openSurvey };

  function renderTab() {
    if (isGuest) {
      switch (activeTab) {
        case 'earn':       return <GuestEarn       {...sharedGuestProps} />;
        case 'redeem':     return <GuestRedeem     {...sharedGuestProps} />;
        case 'refer':      return <GuestRefer      {...sharedGuestProps} />;
        case 'milestones': return <GuestMilestones {...sharedGuestProps} />;
        case 'wallet':     return <GuestWallet     {...sharedGuestProps} />;
        default:           return <GuestHome       {...sharedGuestProps} />;
      }
    }
    switch (activeTab) {
      case 'earn':       return <MemberEarn       {...sharedMemberProps} />;
      case 'redeem':     return <MemberRedeem     {...sharedMemberProps} />;
      case 'wallet':     return <MemberWallet     {...sharedMemberProps} />;
      case 'refer':      return <MemberRefer      {...sharedMemberProps} />;
      case 'milestones': return <MemberMilestones {...sharedMemberProps} />;
      case 'history':    return <MemberHistory    {...sharedMemberProps} />;
      case 'profile':    return <MemberProfile    {...sharedMemberProps} />;
      default:           return <MemberHome       {...sharedMemberProps} />;
    }
  }

  // Lightweight skeleton shown while a lazy tab chunk loads
  const TabSkeleton = (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[1,2,3].map(i => (
        <div key={i} style={{ height: 60, borderRadius: 10, background: '#f3f4f6',
          animation: 'goselfPulse 1.4s ease infinite', animationDelay: `${i * 0.1}s` }} />
      ))}
      <style>{`@keyframes goselfPulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Floating pill button */}
      <LoyaltyButton
        config={effectiveConfig}
        isGuest={isGuest}
        pointsBalance={data.customer?.pointsBalance || 0}
        notifyDot={notifyDot}
        panelOpen={panelOpen}
        onClick={togglePanel}
      />

      {/* Panel */}
      {panelOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="GoSelf Loyalty Rewards"
          style={{
            position: 'fixed',
            bottom: 72,
            [positionKey]: 14,
            width: 'min(390px, calc(100vw - 28px))',
            height: 'min(80vh, 640px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: 18,
            fontFamily: config.fontFamily || 'inherit',
            contain: 'layout paint',
            willChange: 'transform, opacity',
            zIndex: 2147483647,
            background: '#fff',
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
            animation: reducedMotion ? 'none' : 'goselfSlideUp 0.22s cubic-bezier(0.175,0.885,0.32,1.1)',
          }}
        >
          {/* Panel open animation style */}
          <style>{`
            @keyframes goselfSlideUp {
              from { opacity: 0; transform: translateY(18px) scale(0.97); }
              to   { opacity: 1; transform: translateY(0)    scale(1);    }
            }
          `}</style>

          {/* Header */}
          <PanelHeader
            config={effectiveConfig}
            isGuest={isGuest}
            activeTab={activeTab}
            storeName={data.merchant?.storeName || ''}
            onBack={handleBack}
            onClose={closePanel}
            ref={firstFocusRef}
          />

          {/* Guest banner */}
          {isGuest && (
            <GuestBanner config={effectiveConfig} onGate={openGate} />
          )}

          {/* Scrollable tab content + overlays */}
          {hasOpened && (
            <div style={{ flex: 1, overflowY: 'auto', position: 'relative', minHeight: 0 }}>
              <Suspense fallback={TabSkeleton}>
                {renderTab()}
              </Suspense>

              {/* Signup gate (absolute inside scroll area) */}
              {gateOpen && (
                <SignupGate
                  config={effectiveConfig}
                  action={gateAction}
                  onClose={closeGate}
                  onJoin={handleJoin}
                />
              )}

              {/* Survey overlay (absolute inside scroll area) */}
              {surveyOpen && (
                <SurveyOverlay
                  config={effectiveConfig}
                  survey={data.survey}
                  onComplete={closeSurvey}
                  onClose={closeSurvey}
                />
              )}
            </div>
          )}

          {/* Bottom nav */}
          <BottomNav
            config={effectiveConfig}
            activeTab={activeTab}
            isGuest={isGuest}
            activeCouponCount={activeCouponCount}
            setTab={setTab}
          />

          {/* Powered-by */}
          <PoweredByBar />
        </div>
      )}
    </>
  );
}

export default LoyaltyWidget;
