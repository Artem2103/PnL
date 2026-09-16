/**
 * Dev-only: every state of the plan line under the export buttons, and the
 * dialog a refused export opens, without an account or the billing SQL. The
 * studio only shows one of these at a time and only for a real account in the
 * right state, so this is the one place to look at all of them.
 * `?dialog=1` opens the dialog over the page.
 *
 * Not part of the build: Vite's only entry is index.html.
 */
import { createRoot } from 'react-dom/client';
import { LimitDialog } from '../src/components/LimitDialog';
import { PlanNote } from '../src/components/PlanNote';
import { nextMonthUtc, parsePlanStatus } from '../src/lib/billing';
import '../src/styles/global.css';

const resets = nextMonthUtc(new Date()).toISOString();
const free = parsePlanStatus({ free_limit: 1, free_used: 0, free_cards: [], resets_at: resets });
const used = parsePlanStatus({ free_limit: 1, free_used: 1, free_cards: ['a'.repeat(64)], resets_at: resets });
const paid = parsePlanStatus({
  is_paid: true,
  paid_until: new Date(Date.now() + 90 * 86400000).toISOString(),
  resets_at: resets,
});

function States() {
  const dialog = new URLSearchParams(location.search).get('dialog') === '1';
  return (
    <div className="app">
      <main className="pricing">
        <p className="pricing__eyebrow">Plan line under the export buttons</p>
        {[
          ['free-left', free],
          ['this-card-covered', used],
          ['used-up', used],
          ['paid', paid],
        ].map(([allowance, status]) => (
          <div key={allowance as string} className="section" style={{ padding: 16, maxWidth: 560 }}>
            <PlanNote status={status as typeof free} allowance={allowance as 'paid'} />
          </div>
        ))}
      </main>
      {dialog ? <LimitDialog status={used} onClose={() => undefined} onSeePlans={() => undefined} /> : null}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<States />);
