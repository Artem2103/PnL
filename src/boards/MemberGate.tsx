import { useEffect, useId, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { HOME_PATH, navigate } from '../lib/route';
import { BoardsPage } from './BoardsPage';
import { isBoardMember, joinBoard } from './repository';

/**
 * Boards are for MM members only. A signed-in account that isn't one is asked
 * the board password; typed right once, the database marks the account a
 * member and this screen never shows for it again, on any device.
 *
 * This screen is only the door: the board tables themselves answer nothing to
 * a non-member (see `is_board_member` in `supabase/schema.sql`), so skipping
 * it in the browser shows an empty page, not the board.
 */
export function BoardsGate() {
  const { session, mode } = useAuth();
  const accountId = session?.user.id ?? null;
  const [member, setMember] = useState<boolean | null | 'checking'>('checking');

  useEffect(() => {
    if (mode === 'local') {
      setMember(true);
      return;
    }
    let cancelled = false;
    setMember('checking');
    void isBoardMember().then((yes) => {
      if (!cancelled) setMember(yes);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, mode]);

  if (member === true) return <BoardsPage />;

  if (member === 'checking') {
    return (
      <div className="auth auth--loading" role="status" aria-live="polite">
        <span className="auth__spinner" aria-hidden="true" />
        <span className="auth__loading-label">Opening Boards…</span>
      </div>
    );
  }

  return <PasswordScreen onJoined={() => setMember(true)} />;
}

function PasswordScreen({ onJoined }: { onJoined: () => void }) {
  const passwordId = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await joinBoard(password);
      onJoined();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <span className="brand__mark" aria-hidden="true" />
          <div>
            <h1>Boards</h1>
            <p>For MM members only. Enter the password to get in.</p>
          </div>
        </div>

        <form className="auth__form" onSubmit={(event) => void submit(event)} noValidate>
          <div className="field">
            <label className="field__label" htmlFor={passwordId}>
              Password
            </label>
            <input
              id={passwordId}
              className="input"
              type="password"
              autoComplete="off"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          </div>

          {error ? (
            <p className="auth__message auth__message--error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn--primary auth__submit" disabled={busy || !password}>
            {busy ? 'Checking…' : 'Enter'}
          </button>
        </form>

        <p className="auth__footnote">You only need it once: after that your account goes straight in.</p>

        <p className="auth__back">
          <button type="button" className="linkish" onClick={() => navigate(HOME_PATH)}>
            Back to Astra
          </button>
        </p>
      </div>
    </div>
  );
}
