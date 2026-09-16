import { useEffect, useId, useRef, useState } from 'react';
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Closes on a click anywhere else or on Escape, like any menu.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isAccount = mode === 'account';
  const name = isAccount ? displayNameFor(user) : 'Not signed in';

  return (
    <div className="profile" ref={wrapRef}>
      <button
        type="button"
        className={`profile__button${open ? ' is-open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Account"
      >
        <Silhouette />
      </button>

      {open ? (
        <div className="profile__menu" id={menuId} role="dialog" aria-label="Account">
          <div className="profile__head">
            <span className="profile__avatar">
              <Silhouette />
            </span>
            <div className="profile__who">
              <strong title={name}>{name}</strong>
              <span title={user?.email ?? undefined}>
                {isAccount ? user?.email : 'Accounts are off — saved in this browser only'}
              </span>
            </div>
          </div>
          {isAccount && onOpenPlans ? (
            <button
              type="button"
              className="btn btn--ghost btn--small profile__signout"
              onClick={() => {
                setOpen(false);
                onOpenPlans();
              }}
            >
              Plans &amp; promo codes
            </button>
          ) : null}
          {isAccount ? (
            <button
              type="button"
              className="btn btn--ghost btn--small profile__signout"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              Log out
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
