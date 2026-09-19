import { useEffect, useState } from 'react';

/**
 * The app has three pages — the front page at `/`, the editor at `/cards` and
 * the plans at `/pricing` — which is not enough to be worth a router. The path
 * is read from `location` and changed with `history.pushState`; `vercel.json`
 * sends every path to `index.html` so a reload or a shared link to `/cards`
 * lands here too.
 *
 * The editor used to be at `/`. It moved so the front page could have the root,
 * and an unknown path falls through to the front page rather than the editor —
 * a stranger who mistypes should land on the page that explains what this is.
 */

export type Page = 'home' | 'studio' | 'pricing';

export const HOME_PATH = '/';
export const STUDIO_PATH = '/cards';
export const PRICING_PATH = '/pricing';

export function pageFor(pathname: string): Page {
  const path = pathname.replace(/\/+$/, '');
  if (path === PRICING_PATH) return 'pricing';
  if (path === STUDIO_PATH) return 'studio';
  return 'home';
}

const listeners = new Set<() => void>();

export function navigate(to: string): void {
  if (`${location.pathname}${location.search}` === to) return;
  history.pushState(null, '', to);
  window.scrollTo(0, 0);
  for (const listener of listeners) listener();
}

export function useLocation(): { pathname: string; search: string } {
  const read = () => ({ pathname: location.pathname, search: location.search });
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return value;
}

/**
 * Where to go once signed in. The plans page sends a signed-out visitor to the
 * sign-in form with this set, so subscribing does not end on the editor.
 */
const AFTER_SIGN_IN = 'astra:after-sign-in';

export function setAfterSignIn(path: string): void {
  try {
    sessionStorage.setItem(AFTER_SIGN_IN, path);
  } catch {
    /* Private mode: they land on the editor instead. */
  }
}

export function takeAfterSignIn(): string | null {
  try {
    const path = sessionStorage.getItem(AFTER_SIGN_IN);
    sessionStorage.removeItem(AFTER_SIGN_IN);
    return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
  } catch {
    return null;
  }
}
