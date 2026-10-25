import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { addTrades, useJournal } from '../store';
import { demoTrades } from '../demo';
import {
  balanceAt,
  balanceCurve,
  closedTrades,
  floatingPnl,
  heatmap,
  monthBalances,
  performance,
  periodStart,
  pnlPercentages,
  sumPnl,
  tradesInPeriod,
} from '../stats';
import { PERIODS, type Period, type Trade } from '../types';
import { periodCardTitle, type ShareSubject } from '../shareCard';
import { Overlay } from './Overlay';
import { CloseIcon, SettingsIcon, Silhouette } from './icons';
import { BalancePanel, CurvePanel, PerformancePanel } from './Panels';
import { HistorySection } from './History';
import { TradeFormModal } from './TradeForm';
import { SettingsModal } from './SettingsModal';
import { CalendarModal } from './CalendarModal';
import { ShareCardModal } from './ShareCardModal';
import { monthLabel } from './format';
import '../../styles/journal.css';
import '../../styles/journal-studio.css';

export function JournalModal({
  name,
  accountLabel,
  onOpenPlans,
  onSignOut,
  onClose,
}: {
  name: string;
  accountLabel: string;
  onOpenPlans?: () => void;
  onSignOut?: () => void;
  onClose: () => void;
}) {
  const { userId } = useAuth();
  const id = userId ?? '';
  const journal = useJournal(id);
  const { trades, settings } = journal;
  const currency = settings.currency;

  const [period, setPeriod] = useState<Period>('max');
  const [now, setNow] = useState(() => Date.now());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // undefined: closed; null: adding; a trade: editing it.
  const [editing, setEditing] = useState<Trade | null | undefined>(undefined);
  const [share, setShare] = useState<ShareSubject | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  // "5m ago" should not freeze while the journal sits open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const start = periodStart(period, now);
  const derived = useMemo(() => {
    const inPeriod = tradesInPeriod(trades, start, now);
    const percentages = pnlPercentages(trades, settings);
    const closed = closedTrades(trades);
    const realized = sumPnl(closed);
    return {
      inPeriod,
      percentages,
      realized,
      returnPct: settings.startingBalance > 0 ? (realized / settings.startingBalance) * 100 : 0,
      since: closed.length ? Math.min(...closed.map((t) => Date.parse(t.openedAt))) : null,
      closedCount: closed.length,
      balance: balanceAt(trades, settings),
      floating: floatingPnl(trades),
      grid: heatmap(inPeriod),
      curve: balanceCurve(trades, settings, start, now),
      stats: performance(inPeriod, percentages),
    };
  }, [now, settings, start, trades]);

  const sharePeriod = () => {
    const startBalance = start === null ? settings.startingBalance : balanceAt(trades, settings, start - 1);
    setShare({
      kind: 'period',
      title: periodCardTitle(period),
      startBalance,
      endBalance: balanceAt(trades, settings, now),
    });
  };

  const shareMonth = (year: number, month: number) => {
    const { start: startBalance, end: endBalance } = monthBalances(trades, settings, year, month);
    setShare({ kind: 'period', title: monthLabel(year, month, true), startBalance, endBalance });
  };

  const loadDemo = () => {
    setDemoError(null);
    void addTrades(demoTrades()).catch((error: unknown) =>
      setDemoError(error instanceof Error ? error.message : 'The demo trades were not added.'),
    );
  };

  return (
    <Overlay label="Trading journal" className="jx-journal" onClose={onClose}>
      <header className="jx-head">
        <strong className="jx-head__name" title={name}>
          {name}
        </strong>
        <span className="jx-head__label" title={accountLabel}>
          {accountLabel}
        </span>
        <span className="jx-head__avatar" aria-hidden="true">
          <Silhouette />
        </span>
        <span className="jx-spacer" />
        <span className="jx-head__divider" aria-hidden="true" />
        <div className="jx-periods" role="group" aria-label="Period">
          {PERIODS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`jx-period${period === option.id ? ' is-active' : ''}`}
              aria-pressed={period === option.id}
              onClick={() => setPeriod(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="jx-head__divider" aria-hidden="true" />
        <button type="button" className="jx-iconbtn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
          <SettingsIcon />
        </button>
        <button type="button" className="jx-iconbtn jx-head__close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </header>

      {journal.storage === 'browser-fallback' ? (
        <p className="jx-banner" role="status">
          The journal tables are not in the database yet — trades are saved in this browser until{' '}
          <code>supabase/schema.sql</code> is run.
        </p>
      ) : null}
      {journal.status === 'error' || demoError ? (
        <p className="jx-banner jx-banner--error" role="alert">
          {journal.error ?? demoError}
        </p>
      ) : null}

      <div className="jx-body">
        <div className="jx-panels">
          <BalancePanel
            balance={derived.balance}
            floating={derived.floating}
            startingBalance={settings.startingBalance}
            realized={derived.realized}
            returnPct={derived.returnPct}
            since={derived.since}
            tradeCount={derived.closedCount}
            grid={derived.grid}
            currency={currency}
            now={now}
          />
          <CurvePanel points={derived.curve} currency={currency} onOpenCalendar={() => setCalendarOpen(true)} />
          <PerformancePanel stats={derived.stats} currency={currency} onShare={sharePeriod} />
        </div>

        <HistorySection
          trades={derived.inPeriod}
          percentages={derived.percentages}
          currency={currency}
          now={now}
          onAdd={() => setEditing(null)}
          onEdit={(trade) => setEditing(trade)}
          onShare={(trade) =>
            setShare({ kind: 'trade', trade, pct: derived.percentages.get(trade.id) ?? 0 })
          }
          onLoadDemo={journal.status === 'ready' && trades.length === 0 ? loadDemo : undefined}
        />
      </div>

      {journal.status === 'loading' ? <div className="jx-loading">Loading your trades…</div> : null}

      {calendarOpen ? (
        <CalendarModal
          trades={trades}
          currency={currency}
          periodStart={start}
          onShareMonth={shareMonth}
          onClose={() => setCalendarOpen(false)}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsModal
          settings={settings}
          storage={journal.storage}
          tradeCount={trades.length}
          account={{ name, label: accountLabel, onOpenPlans, onSignOut }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {editing !== undefined ? (
        <TradeFormModal trade={editing} currency={currency} onClose={() => setEditing(undefined)} />
      ) : null}
      {share ? (
        <ShareCardModal
          userId={id}
          subject={share}
          currency={currency}
          onClose={() => setShare(null)}
        />
      ) : null}
    </Overlay>
  );
}
