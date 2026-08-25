import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { AuthScreen } from './AuthScreen';

/**
 * Decides which of the two screens the app is. While the persisted session is
 * being restored it shows neither — rendering the sign-in form first would flash
 * it in the face of someone who is already signed in.
 *
 * With no Supabase credentials there is no third screen and no setup notice:
 * the studio opens, keyed on `LOCAL_USER_ID`, and everything stays in this
 * browser. That is the pre-accounts app, unchanged, and it is what the
 * unconfigured state now means. Nothing switches it on or off — filling in
 * `.env.local` puts the sign-in form back by itself, which is the property
 * worth keeping if this is ever revisited.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading, mode } = useAuth();

  if (mode === 'local') return <>{children}</>;

  if (loading) {
    return (
      <div className="auth auth--loading" role="status" aria-live="polite">
        <span className="auth__spinner" aria-hidden="true" />
        <span className="auth__loading-label">Restoring your session…</span>
      </div>
    );
  }

  return session ? <>{children}</> : <AuthScreen />;
}
