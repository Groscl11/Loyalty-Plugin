/**
 * useShake — GoSelf Loyalty Widget V6
 * Returns `true` for 700ms whenever the shake fires.
 * Respects prefers-reduced-motion.
 */

import { useState, useEffect } from 'react';

export function useShake(enabled, intervalSec) {
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    // Respect accessibility preference
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const fire = () => {
      setShaking(true);
      setTimeout(() => setShaking(false), 700);
    };

    const initialDelay = setTimeout(fire, 1600);
    const interval = setInterval(fire, intervalSec * 1000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, [enabled, intervalSec]);

  return shaking;
}
