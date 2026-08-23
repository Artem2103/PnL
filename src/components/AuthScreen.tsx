import { useId, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';

type Mode = 'signin' | 'signup';

// Supabase's own floor is 6. Raising it here keeps the rejection in the form,
// next to the field, rather than coming back as a server error after a round
// trip — and six characters is not a password.
const MIN_PASSWORD = 8;

export function AuthScreen() {
  const { configured, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();

  const isSignUp = mode === 'signup';

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    // Carry the email across — retyping it is the most common annoyance when a
    // sign-in turns out to need an account first. The secrets do not carry.
    setPassword('');
    setConfirm('');
    setError(null);
    setNotice(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);

    if (!email.trim()) return setError('Enter your email address.');
    if (password.length < MIN_PASSWORD) {
      return setError(`Password must be at least ${MIN_PASSWORD} characters.`);
    }
    if (isSignUp && password !== confirm) return setError('The two passwords do not match.');

    setBusy(true);
    try {
      if (isSignUp) {
        const signedIn = await signUp(email, password);
        if (!signedIn) {
          // Email confirmation is on. There is no session yet, so the gate will
          // keep showing this screen — say why, instead of looking broken.
          setNotice(`Check ${email.trim()} for a confirmation link, then sign in.`);
          setMode('signin');
          setPassword('');
          setConfirm('');
        }
        // When it is off, the session arrives and the gate swaps this screen
        // for the studio on its own.
      } else {
        await signIn(email, password);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
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
            <h1>PnL Card Studio</h1>
            <p>Sign in to open the card editor.</p>
          </div>
        </div>

        {configured ? null : (
          <p className="auth__message auth__message--error" role="alert">
            Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code>,
            fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> from your
            project's API settings, then restart the dev server.
          </p>
        )}

        <div className="segmented" role="radiogroup" aria-label="Sign in or create an account">
          <button
            type="button"
            role="radio"
            aria-checked={!isSignUp}
            className={`segmented__item${isSignUp ? '' : ' is-active'}`}
            onClick={() => switchMode('signin')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={isSignUp}
            className={`segmented__item${isSignUp ? ' is-active' : ''}`}
            onClick={() => switchMode('signup')}
          >
            Create account
          </button>
        </div>

        <form className="auth__form" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className="field">
            <label className="field__label" htmlFor={emailId}>
              Email
            </label>
            <input
              id={emailId}
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={!configured || busy}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor={passwordId}>
              Password
              {isSignUp ? <em>at least {MIN_PASSWORD} characters</em> : null}
            </label>
            <input
              id={passwordId}
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              // Tells a password manager to offer a new password on sign-up and
              // the saved one on sign-in, instead of guessing from the markup.
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              required
              disabled={!configured || busy}
            />
          </div>

          {isSignUp ? (
            <div className="field">
              <label className="field__label" htmlFor={confirmId}>
                Confirm password
              </label>
              <input
                id={confirmId}
                className="input"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
                disabled={!configured || busy}
              />
            </div>
          ) : null}

          {error ? (
            <p className="auth__message auth__message--error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="auth__message" role="status">
              {notice}
            </p>
          ) : null}

          <button type="submit" className="btn btn--primary auth__submit" disabled={!configured || busy}>
            {busy
              ? isSignUp
                ? 'Creating account…'
                : 'Signing in…'
              : isSignUp
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <p className="auth__footnote">
          Your account keeps your card and the images you upload, so they are there on your next
          device. The card itself is still drawn in your browser — nothing is rendered on a server.
        </p>
      </div>
    </div>
  );
}
