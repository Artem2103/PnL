import { useMemo, useState } from 'react';
import type { Trade } from '../types';
import { dailyTotals, dayKey, monthGrid, monthSummary, streaks } from '../stats';
import { Overlay } from './Overlay';
import { AstraMark, ChevronLeft, ChevronRight, CloseIcon, ShareIcon } from './icons';
import { compact, monthLabel, tone } from './format';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function days(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

export function CalendarModal({
  trades,
  currency,
  periodStart,
  onShareMonth,
  onClose,
}: {
  trades: Trade[];
  currency: string;
  /** Days before the journal's period filter are dimmed; null for Max. */
  periodStart: number | null;
  onShareMonth: (year: number, month: number) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const daily = useMemo(() => dailyTotals(trades), [trades]);
  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month, daily), [cursor, daily]);
  const summary = useMemo(() => monthSummary(daily, cursor.year, cursor.month), [cursor, daily]);
  const todayKey = dayKey(today);
  const streak = useMemo(
    () => streaks(daily, cursor.year, cursor.month, new Date(`${todayKey}T12:00:00`)),
    [cursor, daily, todayKey],
  );
  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-US', { month: 'long' });

  const move = (delta: number) =>
    setCursor(({ year, month }) => {
      const next = new Date(year, month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  const isCurrentMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth();
  // Strength of a day's tint, and the month's best day, which the reference
  // marks in gold with a dot.
  const { monthMax, bestKey } = useMemo(() => {
    let max = 0;
    let best: string | null = null;
    let bestNet = 0;
    for (const week of weeks) {
      for (const cell of week) {
        if (!cell?.total) continue;
        max = Math.max(max, Math.abs(cell.total.net));
        if (cell.total.net > bestNet) {
          bestNet = cell.total.net;
          best = cell.key;
        }
      }
    }
    return { monthMax: max, bestKey: best };
  }, [weeks]);
  const tint = (net: number) => {
    if (net === 0 || monthMax <= 0) return undefined;
    const alpha = 0.05 + 0.1 * Math.sqrt(Math.abs(net) / monthMax);
    return net > 0 ? `rgba(47, 227, 172, ${alpha * 0.8})` : `rgba(236, 57, 122, ${alpha})`;
  };

  const decided = summary.winTotal - summary.lossTotal;
  const winShare = decided > 0 ? (summary.winTotal / decided) * 100 : 50;
  const periodStartKey = periodStart === null ? null : dayKey(new Date(periodStart));

  return (
    <Overlay label="PnL calendar" className="jx-cal" onClose={onClose}>
      <header className="jx-cal__head">
        <h2>PNL Calendar</h2>
        <div className="jx-cal__nav">
          <button type="button" className="jx-iconbtn" onClick={() => move(-1)} aria-label="Previous month">
            <ChevronLeft />
          </button>
          <span className="jx-cal__month">{monthLabel(cursor.year, cursor.month)}</span>
          <button
            type="button"
            className="jx-iconbtn"
            onClick={() => move(1)}
            disabled={isCurrentMonth}
            aria-label="Next month"
          >
            <ChevronRight />
          </button>
        </div>
        <span className="jx-cal__currency">{currency}</span>
        <button
          type="button"
          className="jx-iconbtn jx-cal__share"
          onClick={() => onShareMonth(cursor.year, cursor.month)}
          aria-label={`Share ${monthLabel(cursor.year, cursor.month, true)} card`}
          title="Share month"
        >
          <ShareIcon />
        </button>
        <span className="jx-cal__divider" aria-hidden="true" />
        <button type="button" className="jx-iconbtn" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </header>

      <div className="jx-cal__summary">
        <strong className={`jx-cal__total ${tone(summary.total)}`}>{compact(summary.total, currency)}</strong>
        <div className="jx-split" role="img" aria-label={`${summary.winDays} winning days, ${summary.lossDays} losing days`}>
          <span className="jx-split__up" style={{ width: `${winShare}%` }} />
          <span className="jx-split__down" style={{ width: `${100 - winShare}%` }} />
        </div>
        <div className="jx-split__labels">
          <span className="is-up">
            {summary.winDays} / {compact(summary.winTotal, currency, false)}
          </span>
          <span className="is-down">
            {summary.lossDays} / {compact(Math.abs(summary.lossTotal), currency, false)}
          </span>
        </div>
      </div>

      <div className="jx-cal__weekdays" aria-hidden="true">
        {WEEKDAYS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      <div
        className={`jx-cal__grid${weeks.length > 5 ? ' jx-cal__grid--six' : ''}`}
        role="grid"
        aria-label={`${monthName} ${cursor.year}`}
      >
        {weeks.map((week, w) => (
          <div className="jx-cal__week" role="row" key={w}>
            {week.map((cell, i) =>
              // Days still to come are left blank, as in the reference.
              cell && cell.key <= todayKey ? (
                <div
                  key={cell.key}
                  role="gridcell"
                  className={[
                    'jx-day',
                    cell.total && cell.total.net > 0 ? 'is-up' : '',
                    cell.total && cell.total.net < 0 ? 'is-down' : '',
                    cell.key === bestKey ? 'is-best' : '',
                    cell.key === todayKey ? 'is-today' : '',
                    periodStartKey && cell.key < periodStartKey ? 'is-outside' : '',
                  ].join(' ')}
                  style={cell.total && cell.key !== bestKey ? { background: tint(cell.total.net) } : undefined}
                  aria-label={`${cell.date.toDateString()}: ${cell.total ? `${compact(cell.total.net, currency)}, ${cell.total.count} trades` : 'no trades'}`}
                >
                  <span className="jx-day__num">{cell.day}</span>
                  <span className="jx-day__pnl">
                    {cell.total ? compact(cell.total.net, currency) : compact(0, currency, false)}
                  </span>
                  {cell.total ? (
                    <span className="jx-day__count">
                      {cell.total.count} {cell.total.count === 1 ? 'trade' : 'trades'}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div key={cell?.key ?? `pad-${i}`} className="jx-day jx-day--pad" aria-hidden="true" />
              ),
            )}
          </div>
        ))}
      </div>

      <footer className="jx-cal__foot">
        <div className="jx-chips">
          <span className="jx-chip">
            Current Positive Streak: <b>{days(streak.current)}</b>
          </span>
          <span className="jx-chip">
            Best Positive Streak in {monthName}: <b>{days(streak.bestInMonth)}</b>
          </span>
          <span className="jx-chip">
            Best Green Streak (All Time): <b>{days(streak.bestAllTime)}</b>
          </span>
          <span className="jx-chip">
            Active Days: <b>{streak.activeDaysInMonth} now / {streak.bestMonthActiveDays} best</b>
          </span>
        </div>
        <span className="jx-brand">
          <AstraMark size={16} />
          ASTRA
        </span>
      </footer>
    </Overlay>
  );
}
