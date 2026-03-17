/**
 * SignupGate — GoSelf Loyalty Widget V6
 * Bottom-sheet signup overlay (3 phases: prompt → form → done).
 * Position: absolute, inside the panel content area.
 */

import React, { useState, useEffect, useCallback } from 'react';

const SignupGate = React.memo(function SignupGate({
  action,
  config,
  onJoin,
  onClose,
}) {
  const [phase, setPhase] = useState('prompt'); // 'prompt' | 'form' | 'done'
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');

  const handleContinue = useCallback(() => {
    if (!email) return;
    // Basic email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    setPhase('done');
    // onJoin fires once here after brief animation
    const t = setTimeout(() => onJoin(), 1800);
    return () => clearTimeout(t);
  }, [email, onJoin]);

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

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Join rewards"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#ffffff',
          borderRadius: '18px 18px 0 0',
          zIndex: 11,
          padding: '0 0 20px',
          animation: 'gsSheetsUp 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.1) both',
        }}
      >
        <style>{`
          @keyframes gsSheetsUp {
            from { transform: translateY(100%); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
          }
        `}</style>

        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#e5e7eb' }} />
        </div>

        {phase === 'prompt' && (
          <PromptPhase action={action} config={config} onContinue={() => setPhase('form')} onClose={onClose} />
        )}
        {phase === 'form' && (
          <FormPhase
            name={name} setName={setName}
            email={email} setEmail={setEmail}
            onContinue={handleContinue}
            onBack={() => setPhase('prompt')}
          />
        )}
        {phase === 'done' && (
          <DonePhase config={config} />
        )}
      </div>
    </>
  );
});

/* ── Prompt phase ─────────────────────────────────────────────────────────── */
function PromptPhase({ action, config, onContinue, onClose }) {
  const bullets = [
    `🪙 100 welcome ${config.pointsNoun} added right now`,
    `🛍️ Earn 1 ${config.pointsAbbrev} per ₹1 on every order automatically`,
    `🎁 Redeem for discounts, free products & partner brands`,
    `🏆 Unlock milestone ${config.rewardNoun}s as you shop`,
  ];

  return (
    <div style={{ padding: '8px 20px 0' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 28, marginBottom: 6 }}>🔒</div>
        <div style={{ fontWeight: 700, fontSize: 17, color: '#111827' }}>
          Members only
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
          Sign up free to {action}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 20 }}>
        {bullets.map((b, i) => (
          <div key={i} style={{ fontSize: 13, color: '#374151', display: 'flex', gap: 8 }}>
            <span>{b}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onContinue}
        style={primaryBtn(config.accentColor)}
      >
        🚀 Join &amp; Start Earning Free
      </button>
      <button
        onClick={onClose}
        style={secondaryBtn}
      >
        Maybe later
      </button>
    </div>
  );
}

/* ── Form phase ───────────────────────────────────────────────────────────── */
function FormPhase({ name, setName, email, setEmail, onContinue, onBack }) {
  return (
    <div style={{ padding: '8px 20px 0' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 17, color: '#111827' }}>
          Create your account
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 3 }}>
          Takes 10 seconds. No spam, ever.
        </div>
      </div>

      <input
        type="text"
        placeholder="Your first name"
        value={name}
        onChange={e => setName(e.target.value)}
        style={inputStyle}
        autoComplete="given-name"
      />
      <input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={e => setEmail(e.target.value)}
        style={{ ...inputStyle, marginTop: 10 }}
        autoComplete="email"
      />

      <button
        onClick={onContinue}
        disabled={!email}
        style={{
          ...primaryBtn('#6366f1'),
          marginTop: 16,
          opacity: email ? 1 : 0.45,
          cursor: email ? 'pointer' : 'not-allowed',
        }}
      >
        Continue →
      </button>
      <button onClick={onBack} style={secondaryBtn}>
        ← Back
      </button>
    </div>
  );
}

/* ── Done phase ───────────────────────────────────────────────────────────── */
function DonePhase({ config }) {
  return (
    <div style={{ padding: '16px 20px 0', textAlign: 'center' }}>
      <div style={{ fontSize: 52, marginBottom: 10 }}>🎉</div>
      <div style={{ fontWeight: 700, fontSize: 19, color: '#111827' }}>
        Welcome aboard!
      </div>
      <div style={{ fontSize: 14, color: '#16a34a', fontWeight: 600, marginTop: 8 }}>
        +100 welcome {config.pointsNoun} added
      </div>
      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
        Setting up your rewards…
      </div>
    </div>
  );
}

/* ── Shared button styles ─────────────────────────────────────────────────── */
const primaryBtn = (color) => ({
  width: '100%',
  padding: '13px 0',
  background: color,
  color: '#ffffff',
  border: 'none',
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  marginTop: 4,
});

const secondaryBtn = {
  width: '100%',
  padding: '10px 0',
  background: 'transparent',
  color: '#9ca3af',
  border: 'none',
  fontSize: 13,
  cursor: 'pointer',
  marginTop: 6,
};

const inputStyle = {
  width: '100%',
  padding: '11px 14px',
  border: '1.5px solid #e5e7eb',
  borderRadius: 10,
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  color: '#111827',
};

export default SignupGate;
