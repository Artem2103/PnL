import { HOME_PATH, PRICING_PATH, STUDIO_PATH, navigate, type Page } from '../lib/route';

/**
 * The left half of the topbar, shared by all three pages: the wordmark, which
 * is the way home, and the two sections beside it.
 *
 * Every entry is a real `<a href>` whose click is intercepted. That is not
 * decoration — it is what keeps middle-click, ⌘-click and "copy link address"
 * working on a client-side router, and what lets the browser show the
 * destination in the status bar before anyone commits to it.
 */

const LINKS = [
  { page: 'studio', href: STUDIO_PATH, label: 'Cards' },
  { page: 'pricing', href: PRICING_PATH, label: 'Plans' },
] as const satisfies readonly { page: Page; href: string; label: string }[];

export function SiteNav({ current }: { current: Page }) {
  const go = (to: string) => (event: React.MouseEvent) => {
    // A modified click is the browser's to handle: it means another tab.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };

  return (
    <div className="brandbar">
      <a className="brand brand--link" href={HOME_PATH} onClick={go(HOME_PATH)}>
        <span className="brand__mark" aria-hidden="true" />
        <h1>Astra</h1>
      </a>
      <nav className="sitenav" aria-label="Sections">
        {LINKS.map((link) => (
          <a
            key={link.page}
            className={`sitenav__link${current === link.page ? ' is-current' : ''}`}
            href={link.href}
            onClick={go(link.href)}
            aria-current={current === link.page ? 'page' : undefined}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
