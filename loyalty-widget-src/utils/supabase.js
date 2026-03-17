/**
 * supabase.js — shared Supabase credentials.
 * Single source of truth — import from here everywhere.
 */

export const SUPABASE_URL = 'https://lizgppzyyljqbmzdytia.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpemdwcHp5eWxqcWJtemR5dGlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MDE0MDYsImV4cCI6MjA3OTk3NzQwNn0.E5yJHY4mjOvLiqZCfCp9vnNC7xsRAlBSdW55YE2RPC0';

export const SUPABASE_HEADERS = {
  'Content-Type': 'application/json',
  Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
  apikey:         SUPABASE_ANON_KEY,
};
