import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, requireSupabase, supabase } from './supabase';
import { syncLibrary } from './library';
import { purgeUser } from './images';
import { clearLocalCard } from './defaults';

interface AuthValue {
  /** Null until the first session lookup resolves — see `loading`. */
  session: Session | null;
  user: User | null;
  /** True while the stored session is being restored on first paint. */
  loading: boolean;
  configured: boolean;
  /**
   * Moves each time the media library has been reconciled with the account.
   * The picker watches it rather than re-listing on a timer: it is the only
   * moment at which a file uploaded on another device can suddenly exist here.
   */
  librarySyncedAt: number;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves to true when a session came back, false when the address still
   *  has to be confirmed by email before the account can sign in. */
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [librarySyncedAt, setLibrarySyncedAt] = useState(0);
  // With no credentials there is no session to wait for, so the gate can render
  // its setup notice immediately instead of spinning forever.
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    // Restores the session persisted by a previous visit, and picks up the one
    // handed back in the URL after an email confirmation link.
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
    });

    // Fires on sign-in, sign-out, token refresh and password recovery, in this
    // tab and in any other tab sharing the same storage.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // Pull the account's media manifest once per signed-in user. Bytes are not
  // downloaded here — this only makes the tiles exist, and `ensureBlob` fetches
  // a file the first time something actually draws it.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void syncLibrary(userId)
      .catch((error: unknown) => {
        // A library that will not sync must not block the editor: the card and
        // anything already cached here still work.
        console.warn('Media library sync failed:', error);
      })
      .finally(() => {
        if (!cancelled) setLibrarySyncedAt(Date.now());
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await requireSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(friendlyMessage(error.message));
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await requireSupabase().auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Where the confirmation link comes back to. Whatever origin the app is
        // served from has to be listed under Authentication → URL Configuration
        // in the Supabase dashboard, or the link bounces.
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw new Error(friendlyMessage(error.message));
    // A project with email confirmation on returns a user but no session; the
    // account is not usable until the link in the inbox is clicked.
    return Boolean(data.session);
  }, []);

  const signOut = useCallback(async () => {
    // Read before the sign-out: afterwards there is no session to ask.
    const leaving = session?.user.id ?? null;
    const { error } = await requireSupabase().auth.signOut();
    if (error) throw new Error(error.message);

    // Everything below is a cache with a durable copy in the account, so
    // dropping it costs a re-download and nothing else. Leaving one person's
    // uploads in a shared browser's IndexedDB would cost rather more.
    if (leaving) {
      clearLocalCard(leaving);
      await purgeUser(leaving).catch(() => {
        /* A cache that will not clear should not fail the sign-out. */
      });
    }
    setLibrarySyncedAt(0);
  }, [session]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      configured: isSupabaseConfigured,
      librarySyncedAt,
      signIn,
      signUp,
      signOut,
    }),
    [librarySyncedAt, loading, session, signIn, signOut, signUp],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}

// Supabase's wording is aimed at the developer reading the network tab. These
// are the three a person typing into the form will actually hit.
function friendlyMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return 'That email and password do not match an account.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Confirm your email address first — check your inbox for the link.';
  }
  if (lower.includes('user already registered')) {
    return 'That email already has an account. Sign in instead.';
  }
  return message;
}
