import { useEffect, useRef } from 'react';
import { formatDay, formatUsd, PLANS, type PlanStatus } from '../lib/billing';

/**
 * Shown instead of an export when the free card for the month has already
 * gone on a different card. Says exactly why, when it comes back, and what a
 * plan costs, with one way on.
 */
export function LimitDialog({
  status,
  onClose,
  onSeePlans,
}: {
  status: PlanStatus;
  onClose: () => void;
  onSeePlans: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cheapest = Math.min(...PLANS.map((plan) => plan.price / plan.months));
  const month = new Date(status.resetsAt.getTime() - 1).toLocaleDateString('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  });

  return (
    <div
      className="dialog"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog__card" role="dialog" aria-modal="true" aria-labelledby="limit-title">
        <p className="pricing__eyebrow">Free plan</p>
        <h2 id="limit-title">This month's free card is used</h2>
        <p>
          A free account makes {status.freeLimit} card a month, and {month}'s went on a card with
          different numbers. You can still restyle and re-export that one. A new free card comes
          back on {formatDay(status.resetsAt)}.
        </p>
        <p>
          A plan makes unlimited cards, from {formatUsd(cheapest)} a month — or redeem a promo code on
          the plans page.
        </p>
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Not now
          </button>
          <button type="button" className="btn btn--primary" onClick={onSeePlans} ref={primaryRef}>
            See plans
          </button>
        </div>
      </div>
    </div>
  );
}
