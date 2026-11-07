import { useEffect, useRef, useState } from 'react';
import { SITE_THEMES, setSiteTheme, useSiteTheme } from '../lib/siteTheme';

/** The theme picker in the topbar, beside the profile button. */
export function ThemeMenu() {
  const theme = useSiteTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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

  return (
    <div className="thememenu" ref={rootRef}>
      <button
        type="button"
        className={`thememenu__button${open ? ' is-open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${theme.label}`}
        title="Theme"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-.6-.3-1-.6-1.5-.4-.6-.5-1.3 0-1.9.4-.4 1-.6 1.600-.6H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" />
          <circle cx="7.5" cy="11" r="1" fill="currentColor" />
          <circle cx="11" cy="7.5" r="1" fill="currentColor" />
          <circle cx="15.5" cy="8.5" r="1" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <div className="thememenu__list" role="menu" aria-label="Theme">
          {SITE_THEMES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === theme.id}
              className={option.id === theme.id ? 'is-active' : ''}
              onClick={() => setSiteTheme(option.id)}
            >
              <span className="thememenu__swatch" style={{ background: option.bg, borderColor: option.borderStrong }} aria-hidden="true">
                <i style={{ background: option.card }} />
                <i style={{ background: option.accent }} />
              </span>
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
