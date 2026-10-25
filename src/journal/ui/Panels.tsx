import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CurvePoint, HeatCell, Performance } from '../stats';
import { CalendarIcon, ClockIcon, InfoIcon, ShareIcon, TradesIcon } from './icons';
import { money, pct, shortDateTime, tone } from './format';

/* ------------------------------------------------------------------ */
/* Balance                                                             */
/* ------------------------------------------------------------------ */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOUR_LABELS: Record<number, string> = { 0: '12a', 6: '6a', 12: '12p', 18: '6p' };
/** One heatmap column: a 9px cell and a 1px gap. */
const PITCH = 10;

function hourRange(hour: number): string {
  const pad = (n: number) => `${String(n % 24).padStart(2, '0')}:00`;
  return `${pad(hour)}–${pad(hour + 1)}`;
}

function clockLabel(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "61d", "5mo" — how long the journal has been running. */
function spanLabel(ms: number): string {
  const days = Math.max(0, Math.floor(ms / 86_400_000));
  return days < 60 ? `${days}d` : `${Math.floor(days / 30)}mo`;
}

/** Net PnL as a cell colour: teal or pink, stronger with size. */
function cellColor(cell: HeatCell, max: number): string | undefined {
  if (!cell.count) return undefined;
  if (cell.net === 0 || max <= 0) return 'rgb(44, 45, 51)';
  const alpha = 0.1 + 0.24 * Math.sqrt(Math.abs(cell.net) / max);
  return cell.net > 0 ? `rgba(47, 227, 172, ${alpha})` : `rgba(236, 57, 122, ${alpha})`;
}

export function BalancePanel({
  balance,
  floating,
  startingBalance,
  realized,
  returnPct,
  since,
  tradeCount,
  grid,
  currency,
  now,
}: {
  balance: number;
  floating: number;
  startingBalance: number;
  realized: number;
  returnPct: number;
  /** First trade's open time, or null for an empty journal. */
  since: number | null;
  tradeCount: number;
  grid: HeatCell[][];
  currency: string;
  now: number;
}) {
  const [hover, setHover] = useState<{ day: number; hour: number } | null>(null);
  const max = useMemo(
    () => Math.max(0, ...grid.flatMap((row) => row.map((cell) => Math.abs(cell.net)))),
    [grid],
  );
  const hovered = hover ? grid[hover.day]?.[hover.hour] : null;
  const date = new Date(now);
  const today = (date.getDay() + 6) % 7;
  const marker = (date.getHours() + date.getMinutes() / 60) * PITCH;

  return (
    <section className="jx-panel jx-balance" aria-label="Balance">
      <header className="jx-panel__head">
        <h3>Balance</h3>
        <span className="jx-panel__meta">{currency}</span>
      </header>

      <div className="jx-balance__top">
        <dl className="jx-figures">
          <dt>Current Balance</dt>
          <dd className="jx-big">{money(balance, currency, false)}</dd>
          <dt>Unrealized PNL</dt>
          <dd className={`jx-mid ${tone(floating)}`}>{money(floating, currency)}</dd>
        </dl>

        <div className="jx-heat" onPointerLeave={() => setHover(null)}>
          <div className="jx-heat__hours" aria-hidden="true">
            {Object.entries(HOUR_LABELS).map(([hour, label]) => (
              <span key={hour} style={{ left: Number(hour) * PITCH }}>
                {label}
              </span>
            ))}
          </div>
          <div className="jx-heat__days" aria-hidden="true">
            {DAYS.map((day, i) => (
              <span key={day} className={i === today ? 'is-today' : ''}>
                {day[0]}
              </span>
            ))}
          </div>
          <div className="jx-heat__grid">
            {grid.map((row, day) =>
              row.map((cell, hour) => (
                <span
                  key={`${day}-${hour}`}
                  className={`jx-heat__cell${hover?.day === day && hover.hour === hour ? ' is-hover' : ''}`}
                  style={{ background: cellColor(cell, max) }}
                  onPointerEnter={() => setHover({ day, hour })}
                  aria-label={`${DAYS[day]} ${hourRange(hour)}: ${cell.count} trades, ${money(cell.net, currency)}`}
                />
              )),
            )}
            <span className="jx-heat__base" aria-hidden="true" />
            <span className="jx-heat__now" style={{ left: marker }} aria-hidden="true" />
          </div>
          <span
            className="jx-heat__clock"
            style={{ left: `clamp(24px, ${marker}px, calc(100% - 24px))` }}
            aria-label={`Now: ${clockLabel(date)}`}
          >
            {clockLabel(date)}
          </span>
          {hover && hovered ? (
            <div
              className="jx-tip"
              style={{
                left: `clamp(70px, ${hover.hour * PITCH + 4.5}px, calc(100% - 70px))`,
                top: 19 + hover.day * PITCH,
              }}
            >
              <strong>
                {DAYS[hover.day]} · {hourRange(hover.hour)}
              </strong>
              {hovered.count ? (
                <span>
                  {hovered.count} {hovered.count === 1 ? 'trade' : 'trades'} ·{' '}
                  <b className={tone(hovered.net)}>{money(hovered.net, currency)}</b>
                </span>
              ) : (
                <span className="jx-muted">No trades</span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="jx-balance__bottom">
        <dl className="jx-figures">
          <dt>Starting Balance</dt>
          <dd className="jx-big">{money(startingBalance, currency, false)}</dd>
          <dt>Realized PNL</dt>
          <dd className={`jx-big ${tone(realized)}`}>{money(realized, currency)}</dd>
        </dl>
        <dl className="jx-figures jx-figures--right">
          <dt>Account Return</dt>
          <dd>
            <span className="jx-pill">
              <b className={tone(returnPct)}>{pct(returnPct)}</b>
              {since !== null ? (
                <span className="jx-pill__part" title="Since the first trade">
                  <ClockIcon />
                  {spanLabel(now - since)}
                </span>
              ) : null}
            </span>
          </dd>
          <dt className="jx-figures__gap" aria-hidden="true" />
          <dd className="jx-big jx-figures__count" title="Closed trades">
            <TradesIcon />
            {tradeCount}
          </dd>
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Balance curve                                                       */
/* ------------------------------------------------------------------ */

/** The plot box inside the panel, and the share of it kept clear above and below the line. */
const PLOT = { top: 47, height: 240, marginTop: 0.2, marginBottom: 0.1 };

export function CurvePanel({
  points,
  currency,
  onOpenCalendar,
}: {
  points: CurvePoint[];
  currency: string;
  onOpenCalendar: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    if (width <= 0 || points.length === 0) return null;
    const t0 = points[0]?.time ?? 0;
    const t1 = points[points.length - 1]?.time ?? t0;
    const balances = points.map((p) => p.balance);
    let lo = Math.min(...balances);
    let hi = Math.max(...balances);
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const usable = 1 - PLOT.marginTop - PLOT.marginBottom;
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * width;
    const y = (b: number) => PLOT.top + PLOT.height * (PLOT.marginTop + usable * ((hi - b) / (hi - lo)));
    const xy = points.map((p) => [x(p.time), y(p.balance)] as const);
    const line = xy.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    const last = xy[xy.length - 1];
    const first = xy[0];
    const base = PLOT.top + PLOT.height;
    const area = last && first ? `${line}L${last[0].toFixed(1)},${base}L${first[0].toFixed(1)},${base}Z` : '';
    return { xy, line, area };
  }, [points, width]);

  const first = points[0]?.balance ?? 0;
  const last = points[points.length - 1]?.balance ?? 0;
  const up = last >= first;
  const stroke = up ? 'var(--jx-up)' : 'var(--jx-down)';
  const hoverPoint = hover !== null ? points[hover] : null;
  const hoverXY = hover !== null ? geometry?.xy[hover] : null;

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!geometry) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    let best = 0;
    let bestDistance = Infinity;
    geometry.xy.forEach(([x], i) => {
      const distance = Math.abs(x - px);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <section className="jx-panel jx-curve" aria-label="Balance curve">
      <header className="jx-panel__head">
        <h3>Balance Curve</h3>
        <span className={`jx-curve__delta ${tone(last - first)}`}>{money(last - first, currency)}</span>
        <button
          type="button"
          className="jx-iconbtn jx-panel__action"
          onClick={onOpenCalendar}
          aria-label="PnL calendar"
          title="PnL calendar"
        >
          <CalendarIcon />
        </button>
      </header>
      <div className="jx-curve__plot" ref={wrapRef} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {geometry ? (
          <svg
            width={width}
            height={PLOT.top + PLOT.height}
            role="img"
            aria-label={`Balance from ${money(first, currency, false)} to ${money(last, currency, false)}`}
          >
            <defs>
              <linearGradient
                id="jx-curve-fill"
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={PLOT.top}
                x2="0"
                y2={PLOT.top + PLOT.height}
              >
                <stop offset="0" stopColor={stroke} stopOpacity="0.28" />
                <stop offset="1" stopColor={stroke} stopOpacity="0.045" />
              </linearGradient>
            </defs>
            <path d={geometry.area} fill="url(#jx-curve-fill)" />
            <path d={geometry.line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
            {hoverXY ? (
              <>
                <line x1={hoverXY[0]} x2={hoverXY[0]} y1={PLOT.top} y2={PLOT.top + PLOT.height} className="jx-curve__cross" />
                <circle cx={hoverXY[0]} cy={hoverXY[1]} r="4" className="jx-curve__dot" stroke={stroke} />
              </>
            ) : null}
          </svg>
        ) : null}
        {points.length <= 2 && first === last ? <p className="jx-curve__empty">No closed trades in this period</p> : null}
        {hoverPoint && hoverXY ? (
          <div
            className="jx-tip"
            style={{
              left: Math.min(Math.max(hoverXY[0], 70), width - 70),
              top: Math.max(hoverXY[1] - 12, 30),
            }}
          >
            <strong>{money(hoverPoint.balance, currency, false)}</strong>
            <span className="jx-muted">{shortDateTime(new Date(hoverPoint.time).toISOString())}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

function factor(value: number | null): string {
  if (value === null) return '—';
  if (value === Infinity) return '∞';
  return value.toFixed(2);
}

export function PerformancePanel({
  stats,
  currency,
  onShare,
}: {
  stats: Performance;
  currency: string;
  onShare: () => void;
}) {
  const decided = stats.wins + stats.losses;
  const winShare = decided ? (stats.wins / decided) * 100 : 50;

  return (
    <section className="jx-panel jx-perf" aria-label="Performance">
      <header className="jx-panel__head">
        <h3>Performance</h3>
        <button
          type="button"
          className="jx-iconbtn jx-panel__action"
          onClick={onShare}
          aria-label="Share performance card"
          title="Share"
        >
          <ShareIcon />
        </button>
      </header>
      <dl className="jx-rows">
        <div>
          <dt>Total PnL</dt>
          <dd className={tone(stats.totalPnl)}>{money(stats.totalPnl, currency)}</dd>
        </div>
        <div>
          <dt>Win Rate</dt>
          <dd>{stats.winRate === null ? '—' : `${stats.winRate.toFixed(1)}%`}</dd>
        </div>
        <div>
          <dt>Total Trades</dt>
          <dd>
            <span className="jx-rows__total">{stats.total}</span>
            <span className="is-up">{stats.wins}</span>
            <span className="jx-rows__slash">/</span>
            <span className="is-down">{stats.losses}</span>
          </dd>
        </div>
        <div>
          <dt>
            Profit Factor
            <span className="jx-info" title="Gross profit divided by gross loss">
              <InfoIcon />
            </span>
          </dt>
          <dd className={stats.profitFactor !== null && stats.profitFactor >= 1 ? 'is-up' : stats.profitFactor !== null ? 'is-down' : ''}>
            {factor(stats.profitFactor)}
          </dd>
        </div>
        <div>
          <dt>Avg Win / Loss</dt>
          <dd>
            <span className="is-up">{stats.avgWin === null ? '—' : money(stats.avgWin, currency)}</span>
            <span className="jx-rows__slash">/</span>
            <span className="is-down">{stats.avgLoss === null ? '—' : money(stats.avgLoss, currency)}</span>
          </dd>
        </div>
      </dl>
      <ul className="jx-dist" aria-label="Trades by PnL as % of balance at entry">
        {stats.buckets.map((bucket) => (
          <li key={bucket.id}>
            <span className={`jx-dot jx-dot--${bucket.tone}`} aria-hidden="true" />
            <span className="jx-dist__label">{bucket.label}</span>
            <span className="jx-dist__count">{bucket.count}</span>
          </li>
        ))}
      </ul>
      <div className="jx-ratio" role="img" aria-label={`${stats.wins} wins, ${stats.losses} losses`}>
        <span className="jx-ratio__up" style={{ width: `${winShare}%` }} />
        <span className="jx-ratio__down" style={{ width: `${100 - winShare}%` }} />
      </div>
    </section>
  );
}
