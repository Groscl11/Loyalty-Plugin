/**
 * useRealtime — Supabase Realtime Subscription Hook
 *
 * NOTE: Realtime subscriptions require `authenticated` role via RLS policies
 * on member_loyalty_status. The widget uses the anon key and is not a
 * Supabase-authenticated session, so Realtime cannot deliver events.
 * Point balance updates are handled via manual refetch after each action.
 */

// No-op export — keeps the import in useCustomerData.js working without errors
export function useRealtimeSubscription(_customerEmail, _shopDomain, _onUpdate) {
  // Intentionally disabled — Realtime requires authenticated role (RLS).
  // Manual refetch after redemption/earn actions handles all balance updates.
}

export default useRealtimeSubscription;
