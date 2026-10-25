import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A modal over a dimmed backdrop. They stack — the calendar opens over the
 * journal, a share card over the calendar — and Escape or a backdrop click
 * closes only the top one.
 */

const stack: string[] = [];

export function Overlay({
  label,
  className,
  onClose,
  children,
}: {
  label: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    stack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && stack[stack.length - 1] === id) {
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    // The page under the first modal must not scroll along with the wheel.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(id), 1);
      document.body.style.overflow = overflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [id]);

  return createPortal(
    <div
      className="jx-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`jx-modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
