import type { User } from '@supabase/supabase-js';
import { PROFILE_PATH, navigate, useLocation } from '../lib/route';
import { ThemeMenu } from './ThemeMenu';

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
export function Silhouette() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="15.5" r="7" fill="currentColor" />
      <path d="M4 42c0-9.4 7.2-16 16-16s16 6.6 16 16z" fill="currentColor" />
    </svg>
  );
}

/**
 * The account button in every topbar. It goes to the profile page, which holds
 * what used to hang off this button: plans and log out.
 */
export function ProfileMenu() {
  const { pathname } = useLocation();
  const current = pathname.replace(/\/+$/, '') === PROFILE_PATH;

  return (
    <>
      <ThemeMenu />
      <div className="profile">
      <button
        type="button"
        className={`profile__button${current ? ' is-open' : ''}`}
        onClick={() => navigate(PROFILE_PATH)}
        aria-label="Your profile"
        aria-current={current ? 'page' : undefined}
        title="Profile"
      >
        <Silhouette />
      </button>
      </div>
    </>
  );
}
