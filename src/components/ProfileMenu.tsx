import { lazy, Suspense, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AuthMode } from '../lib/auth';

/**
 * The name to greet someone by: the one given at sign-up, or the part of the
 * address before the @ for accounts made before the form asked for a name.
 */
export function displayNameFor(user: User | null): string {
  const given = user?.user_metadata?.display_name;
  if (typeof given === 'string' && given.trim()) return given.trim();
  const email = user?.email ?? '';
  return email.split('@')[0] || 'Your account';
}

/**
 * A blank avatar: head and shoulders, drawn in the current text colour. Centred
 * on the vertical axis of a square box; the shoulders run past the bottom edge
 * so the round container crops them evenly on both sides.
 */
function Silhouette() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="15.5" r="7" fill="currentColor" />
      <path d="M4 42c0-9.4 7.2-16 16-16s16 6.6 16 16z" fill="currentColor" />
    </svg>
  );
}

const JournalModal = lazy(() =>
  import('../journal/ui/JournalModal').then((module) => ({ default: module.JournalModal })),
);

/**
 * The account button in every topbar. It opens the trading journal — balance,
 * curve, performance and the trade history — in a large modal; the account
 * actions that used to hang in a dropdown here (plans, log out) live in the
 * journal's settings.
 */
export function ProfileMenu({
  user,
  mode,
  onSignOut,
  onOpenPlans,
}: {
  user: User | null;
  mode: AuthMode;
  onSignOut: () => void;
  /** Adds a "Plans" entry; left out on the plans page itself. */
  onOpenPlans?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isAccount = mode === 'account';
  const name = isAccount ? displayNameFor(user) : 'Local journal';
  const label = isAccount ? (user?.email ?? '') : 'Accounts are off — saved in this browser only';

  return (
    <div className="profile">
      <button
        type="button"
        className={`profile__button${open ? ' is-open' : ''}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Account and trading journal"
        title="Trading journal"
      >
        <Silhouette />
      </button>

      {open ? (
        <Suspense fallback={null}>
          <JournalModal
            name={name}
            accountLabel={label}
            onClose={() => setOpen(false)}
            onOpenPlans={
              isAccount && onOpenPlans
                ? () => {
                    setOpen(false);
                    onOpenPlans();
                  }
                : undefined
            }
            onSignOut={
              isAccount
                ? () => {
                    setOpen(false);
                    onSignOut();
                  }
                : undefined
            }
          />
        </Suspense>
      ) : null}
    </div>
  );
}
