/**
 * PoweredByBar — GoSelf Loyalty Widget V6
 * Fixed footer bar — brand requirement, always visible.
 */

import React from 'react';

const PoweredByBar = React.memo(function PoweredByBar() {
  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        padding: '7px 16px',
        borderTop: '1px solid #f3f4f6',
        backgroundColor: '#ffffff',
        fontSize: 11,
        color: '#9ca3af',
        userSelect: 'none',
      }}
    >
      <span>powered by</span>
      {/* GoSelf wordmark — amber G icon */}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontWeight: 700,
          color: '#f59e0b',
          fontSize: 12,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="#f59e0b" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2v-5h2v5zm0-7h-2V7h2v2z"/>
        </svg>
        <span style={{ color: '#374151' }}>GoSelf</span>
      </span>
    </div>
  );
});

export default PoweredByBar;
