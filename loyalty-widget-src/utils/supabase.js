/**
 * supabase.js — shared Supabase credentials.
 * Single source of truth — import from here everywhere.
 *
 * __SUPABASE_URL__ and __SUPABASE_ANON_KEY__ are replaced at build time
 * by esbuild --define (see package.json build scripts).
 * Production build uses prod Supabase; staging build uses staging Supabase.
 */

export const SUPABASE_URL = __SUPABASE_URL__;

export const SUPABASE_ANON_KEY = __SUPABASE_ANON_KEY__;

export const SUPABASE_HEADERS = {
  'Content-Type': 'application/json',
  Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
  apikey:         SUPABASE_ANON_KEY,
};
