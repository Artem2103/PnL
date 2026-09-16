/// <reference types="vite/client" />

// Declared so a typo in a variable name is a compile error rather than an
// `undefined` that only shows up as a failed sign-in at runtime.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "on" once NOWPayments takes cards and Apple Pay, so the plans page says so. */
  readonly VITE_CARD_PAYMENTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
