/**
 * useSWRFetcher — SWR Data Fetching Hook with Polling & Background Revalidation
 *
 * Wraps async data fetching with SWR for intelligent:
 * - Auto-refetch at intervals (polling)
 * - Focus-triggered refetch
 * - Stale-while-revalidate pattern
 * - Error retry with exponential backoff
 *
 * SOLUTION 1: SWR Smart Polling and Revalidation
 */

import { useCallback } from 'react';
import useSWR from 'swr';

/**
 * Wraps apiFetch for use with SWR.
 * Each data domain gets its own SWR instance for fine-grained control.
 */
export function createSWRFetcher(apiFetch, cacheKey, options = {}) {
  const defaultOptions = {
    revalidateOnFocus: true,      // Refetch when user focuses window
    revalidateOnReconnect: true,  // Refetch when network reconnects
    dedupingInterval: 2000,       // Don't make duplicate requests within 2s
    focusThrottleInterval: 5000,  // Wait 5s between focus-induced refetches
    errorRetryCount: 3,           // Retry failed requests up to 3 times
    errorRetryInterval: 1000,     // Wait 1s between retries (exponential backoff)
  };

  const mergedOptions = { ...defaultOptions, ...options };

  return {
    cacheKey,
    fetcher: async (...args) => {
      try {
        const result = await apiFetch(...args);
        return result;
      } catch (err) {
        console.warn(`[GoSelf SWR] Fetch failed for ${cacheKey}:`, err.message);
        throw err;
      }
    },
    isReady: !!apiFetch && !!cacheKey,
    ...mergedOptions,
  };
}

/**
 * useSWRCustomData
 *
 * Provides a typed SWR hook for customer data with sensible defaults.
 * Enables auto-polling + focus-triggered refetch for critical customer session data.
 *
 * Usage:
 *   const { data, error, isLoading, mutate } = useSWRCustomerSession(
 *     '/api/get-loyalty-status?email=...',
 *     apiFetch
 *   );
 *
 *   // Manual refetch:
 *   await mutate(); // Revalidate immediately
 */
export function useSWRCustomerSession(url, fetcher, options = {}) {
  // Customer session is critical — poll every 10s
  const defaultOptions = {
    revalidateInterval: 10000, // Poll every 10s for points updates
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 2000,
    errorRetryCount: 3,
    errorRetryInterval: 1000,
  };

  const mergedOptions = { ...defaultOptions, ...options };
  const swrResult = useSWR(url, fetcher, mergedOptions);

  return {
    ...swrResult,
    mutate: swrResult.mutate, // For manual refetch
    refetch: swrResult.mutate, // Alias for clarity
  };
}

/**
 * useSWREarnRules
 *
 * Earn rules are less critical — poll every 60s only.
 */
export function useSWREarnRules(url, fetcher, options = {}) {
  const defaultOptions = {
    revalidateInterval: 60000, // Poll every 60s
    revalidateOnFocus: true,
    dedupingInterval: 2000,
    errorRetryCount: 2,
  };

  const mergedOptions = { ...defaultOptions, ...options };
  return useSWR(url, fetcher, mergedOptions);
}

/**
 * useSWRPartnerData
 *
 * Partner data, leaderboards, etc. — least critical, poll every 5min.
 */
export function useSWRPartnerData(url, fetcher, options = {}) {
  const defaultOptions = {
    revalidateInterval: 300000, // Poll every 5min
    revalidateOnFocus: true,
    dedupingInterval: 5000,
    errorRetryCount: 1,
  };

  const mergedOptions = { ...defaultOptions, ...options };
  return useSWR(url, fetcher, mergedOptions);
}

/**
 * createGlobalMutate
 *
 * Create a global mutate function that can be called from anywhere
 * to refetch data after user actions (survey submit, order placed, etc).
 *
 * Usage in action handlers:
 *   import { globalMutate } from './hooks/useSWRFetcher.js';
 *   await globalMutate('customer_session');
 */
const globalMutations = {};

export function registerMutation(key, mutateFn) {
  globalMutations[key] = mutateFn;
}

export async function globalMutate(key) {
  if (globalMutations[key]) {
    try {
      await globalMutations[key]();
      console.log(`[GoSelf] Global mutate triggered for: ${key}`);
    } catch (e) {
      console.error(`[GoSelf] Global mutate failed for ${key}:`, e.message);
    }
  }
}

export default {
  createSWRFetcher,
  useSWRCustomerSession,
  useSWREarnRules,
  useSWRPartnerData,
  registerMutation,
  globalMutate,
};
