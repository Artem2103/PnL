import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Vite only exposes variables prefixed with VITE_ to the bundle. The anon key is
// meant to ship to the browser — it is the public half of the pair, and every
// row it can reach is governed by Supabase's row-level security, not by secrecy.
// The service_role key must never appear here.
const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);

// Built lazily rather than at module load: with no credentials, createClient
// throws, and a blank screen is a worse answer than a page that explains which
// two variables are missing.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        // Keeps the user signed in across reloads, and picks the session token
        // out of the URL fragment after an email confirmation link lands here.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/** The client, or a thrown error naming what has to be set up. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.',
    );
  }
  return supabase;
}
