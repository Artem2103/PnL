import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { AuthScreen } from './AuthScreen';

/**
 * Decides which of the two screens the app is. While the persisted session is
 * being restored it shows neither — rendering the sign-in form first would flash
 * it in the face of someone who is already signed in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

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
