import { useMemo, useState } from 'react';
import type { Trade } from '../types';
import { displaySymbol, LOGOS, normalizeSymbol, symbolInitials } from '../symbols';
import { relativeTime } from '../stats';
import { formatPrice } from '../../lib/format';
import { PlusIcon, ShareIcon } from './icons';
import { money, pct, shortDateTime, tone } from './format';

export function SymbolLogo({ symbol, size = 30 }: { symbol: string; size?: number }) {
  const url = LOGOS.get(normalizeSymbol(symbol));
  return url ? (
    <img className="jx-logo" src={url} alt="" width={size} height={size} />
  ) : (
    <span className="jx-logo jx-logo--badge" style={{ width: size, height: size }} aria-hidden="true">
      {symbolInitials(symbol)}
    </span>
  );
}

export function SideBadge({ side }: { side: Trade['side'] }) {
  return <span className={`jx-side jx-side--${side}`}>{side === 'buy' ? 'Buy' : 'Sell'}</span>;
}

/** "5d ago" with the number bright and "ago" muted, as the reference prints it. */
function agoParts(iso: string, now: number) {
  const text = relativeTime(iso, now);
  const match = text.match(/^(\S+) (ago)$/);
  return match ? (
    <>
      <b>{match[1]}</b> {match[2]}
    </>
  ) : (
    <b>{text}</b>
  );
}

/** Tabs the history area will grow into; only History exists today. */
const TABS = [{ id: 'history', label: 'History' }] as const;

export function HistorySection({
  trades,
  percentages,
  currency,
  now,
  onAdd,
  onEdit,
  onShare,
  onLoadDemo,
}: {
  /** Closed trades in the active period. */
  trades: Trade[];
  percentages: Map<string, number>;
  currency: string;
  now: number;
  onAdd: () => void;
  onEdit: (trade: Trade) => void;
  onShare: (trade: Trade) => void;
  /** Offered only while the journal is completely empty. */
  onLoadDemo?: () => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('history');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = normalizeSymbol(query);
    return trades
      .filter((trade) => !needle || normalizeSymbol(trade.symbol).includes(needle))
      .sort((a, b) => Date.parse(b.closedAt ?? '') - Date.parse(a.closedAt ?? ''));
  }, [query, trades]);

  return (
    <section className="jx-history" aria-label="Trade history">
      <div className="jx-history__bar">
        <div className="jx-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`jx-tab${tab === item.id ? ' is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="jx-search">
          <input
            type="search"
            placeholder="Search by pair"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search by pair"
          />
        </label>
        <button type="button" className="jx-btn jx-btn--accent" onClick={onAdd}>
          <PlusIcon /> Add trade
        </button>
      </div>

      <div className="jx-table" role="table" aria-label="Closed trades">
        <div className="jx-table__body">
          <div className="jx-table__head" role="row">
            <span role="columnheader">Pair</span>
            <span role="columnheader">Entry</span>
            <span role="columnheader">Close</span>
            <span role="columnheader">Lots</span>
            <span role="columnheader">PnL</span>
            <span role="columnheader">Date</span>
            <span role="columnheader" className="jx-table__share">Share</span>
          </div>
          {rows.map((trade) => {
            const p = percentages.get(trade.id) ?? 0;
            return (
              <div
                key={trade.id}
                className="jx-table__row"
                role="row"
                tabIndex={0}
                onClick={() => onEdit(trade)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onEdit(trade);
                }}
                title="Edit trade"
              >
                <span role="cell" className="jx-pair">
                  <SymbolLogo symbol={trade.symbol} size={36} />
                  <span className="jx-cell2">
                    <strong className="jx-pair__name">{displaySymbol(trade.symbol)}</strong>
                    <span className="jx-cell2__sub">
                      <SideBadge side={trade.side} />
                      {trade.source === 'mt5' ? <span className="jx-muted">MT5</span> : null}
                    </span>
                  </span>
                </span>
                <span role="cell" className="jx-cell2">
                  <span className="jx-cell2__main">{formatPrice(trade.entryPrice)}</span>
                  <span className="jx-cell2__sub">{shortDateTime(trade.openedAt)}</span>
                </span>
                <span role="cell" className="jx-cell2">
                  <span className="jx-cell2__main">
                    {trade.closePrice === null ? '—' : formatPrice(trade.closePrice)}
                  </span>
                  <span className="jx-cell2__sub">{trade.closedAt ? shortDateTime(trade.closedAt) : 'Open'}</span>
                </span>
                <span role="cell" className="jx-cell2__main">{trade.lots}</span>
                <span role="cell" className={`jx-table__pnl ${tone(trade.pnl)}`}>
                  {money(trade.pnl, currency)} ({pct(p)})
                </span>
                <span role="cell" className="jx-cell2">
                  <span className="jx-ago">{trade.closedAt ? agoParts(trade.closedAt, now) : 'Open'}</span>
                  <span className="jx-cell2__sub">
                    {trade.closedAt ? `closed ${shortDateTime(trade.closedAt)}` : ''}
                  </span>
                </span>
                <span role="cell" className="jx-table__share">
                  <button
                    type="button"
                    className="jx-iconbtn"
                    aria-label={`Share ${displaySymbol(trade.symbol)} trade`}
                    title="Share"
                    onClick={(event) => {
                      event.stopPropagation();
                      onShare(trade);
                    }}
                  >
                    <ShareIcon size={20.5} />
                  </button>
                </span>
              </div>
            );
          })}
          {rows.length === 0 ? (
            <div className="jx-empty">
              {trades.length === 0 ? (
                <>
                  <p>No closed trades in this period.</p>
                  <div className="jx-empty__actions">
                    <button type="button" className="jx-btn jx-btn--accent" onClick={onAdd}>
                      <PlusIcon /> Add trade
                    </button>
                    {onLoadDemo ? (
                      <button type="button" className="jx-btn jx-btn--ghost" onClick={onLoadDemo}>
                        Load demo data
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <p>No trades match “{query}”.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
