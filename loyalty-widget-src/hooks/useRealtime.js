/**
 * useRealtime — Supabase Realtime Subscription Hook
 *
 * Listens for changes to member_loyalty_status table and invalidates cache
 * when customer session updates occur, enabling real-time points display.
 *
 * SOLUTION 2: Supabase Realtime Subscription
 */

import { useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { invalidateCustomerSession } from '../utils/sessionCache.js';

let supabaseInstance = null;

function getSupabaseClient() {
  if (!supabaseInstance && typeof window !== 'undefined') {
    // Get credentials from environment or from the imported supabase.js config
    const SUPABASE_URL = window.__SUPABASE_URL ||
      'https://lizgppzyyljqbmzdytia.supabase.co';
    const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjUzNjEwMjAsImV4cCI6MjA0MDkzNzAyMH0.h0MgSj96ER6YzpzRkIzfAz7kBr0qEZVZ0V0-8r1J4bo';

    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseInstance;
}

/**
 * useRealtimeSubscription
 *
 * Subscribe to real-time changes for a specific customer in a specific shop.
 * When member_loyalty_status updates, invalidate cache + call onUpdate callback.
 *
 * Usage:
 *   useRealtimeSubscription(customerEmail, shopDomain, () => refetch())
 */
export function useRealtimeSubscription(customerEmail, shopDomain, onUpdate) {
  const subscriptionRef = useRef(null);

  useEffect(() => {
    if (!customerEmail || !shopDomain) return;

    (async () => {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) return;

        // Subscribe to member_loyalty_status changes for this customer at this shop
        // Filter: shop_domain = shopDomain AND customer_email = customerEmail
        const channel = supabase
          .channel(`loyalty:${shopDomain}:${customerEmail}`)
          .on(
            'postgres_changes',
            {
              event: '*', // INSERT, UPDATE, DELETE
              schema: 'public',
              table: 'member_loyalty_status',
              filter: `shop_domain=eq.${shopDomain}`,
            },
            (payload) => {
              // Double-check this event is for our customer
              if (payload.new?.customer_email === customerEmail ||
                  payload.old?.customer_email === customerEmail) {
                console.log(
                  '[GoSelf] Realtime update detected:',
                  payload.eventType,
                  'points now:', payload.new?.points_balance
                );
                // Invalidate cache and trigger refetch
                invalidateCustomerSession();
                if (onUpdate) onUpdate();
              }
            }
          )
          .subscribe();

        subscriptionRef.current = channel;
        console.log('[GoSelf] Realtime subscription active for:', customerEmail);
      } catch (err) {
        console.warn('[GoSelf] Realtime subscription setup failed:', err.message);
      }
    })();

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        console.log('[GoSelf] Realtime subscription cleaned up');
      }
    };
  }, [customerEmail, shopDomain, onUpdate]);
}

export default useRealtimeSubscription;
