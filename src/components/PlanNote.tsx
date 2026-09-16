import { allowanceFor, formatDay, type PlanStatus } from '../lib/billing';
import { navigate } from '../lib/route';

/** One line under the export buttons: what the account's plan allows for this card. */
export function PlanNote({
  status,
  allowance,
}: {
  status: PlanStatus;
  allowance: ReturnType<typeof allowanceFor>;
}) {
  const seePlans = (
    <button type="button" className="linkish" onClick={() => navigate('/pricing')}>
      See plans
    </button>
  );
  switch (allowance) {
    case 'paid':
      return (
        <p className="plannote plannote--paid">
          <span className="plannote__tag">Unlimited</span>
          {status.paidUntil ? `Your plan runs until ${formatDay(status.paidUntil)}.` : 'Your plan is active.'}
        </p>
      );
    case 'this-card-covered':
      return (
        <p className="plannote">
          <span className="plannote__tag">Free</span>
          This is this month's free card — restyle and export it as often as you like. {seePlans}
        </p>
      );
    case 'free-left':
      return (
        <p className="plannote">
          <span className="plannote__tag">Free</span>
          {status.freeLimit - status.freeUsed} free card left this month. Exporting uses it on this
          card. {seePlans}
        </p>
      );
    case 'used-up':
      return (
        <p className="plannote plannote--used">
          <span className="plannote__tag">Free</span>
          This month's free card is used; a new one comes on {formatDay(status.resetsAt)}. {seePlans}
        </p>
      );
  }
}
