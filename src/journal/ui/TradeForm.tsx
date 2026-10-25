import { useMemo, useRef, useState } from 'react';
import type { Trade, TradeInput, TradeSide } from '../types';
import { displaySymbol, normalizeSymbol, SYMBOL_SUGGESTIONS } from '../symbols';
import { addTrade, deleteTrade, updateTrade } from '../store';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../../lib/format';
import { Overlay } from './Overlay';
import { CloseIcon } from './icons';
import { SymbolLogo } from './History';

interface Draft {
  symbol: string;
  side: TradeSide;
  entryPrice: string;
  closePrice: string;
  lots: string;
  pnl: string;
  openedAt: string;
  closedAt: string;
  note: string;
}

type Errors = Partial<Record<keyof Draft, string>>;

function draftFrom(trade: Trade | null): Draft {
  if (!trade) {
    const now = new Date();
    now.setSeconds(0, 0);
    const hourAgo = new Date(now.getTime() - 3_600_000);
    return {
      symbol: '',
      side: 'buy',
      entryPrice: '',
      closePrice: '',
      lots: '',
      pnl: '',
      openedAt: toDateTimeLocalValue(hourAgo.toISOString()),
      closedAt: toDateTimeLocalValue(now.toISOString()),
      note: '',
    };
  }
  return {
    symbol: trade.symbol,
    side: trade.side,
    entryPrice: String(trade.entryPrice),
    closePrice: trade.closePrice === null ? '' : String(trade.closePrice),
    lots: String(trade.lots),
    pnl: String(trade.pnl),
    openedAt: toDateTimeLocalValue(trade.openedAt),
    closedAt: trade.closedAt ? toDateTimeLocalValue(trade.closedAt) : '',
    note: trade.note,
  };
}

/** Accepts "1,085.5" and "1.0855"; a comma is read as a decimal point only when there is no dot. */
function parseNumber(value: string): number | null {
  const text = value.trim().replace(/\s/g, '');
  if (!text) return null;
  const normal = text.includes('.') ? text.replace(/,/g, '') : text.replace(',', '.');
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** The draft as a trade, or the reasons it is not one yet. */
export function validate(draft: Draft, base: Trade | null): { input: TradeInput | null; errors: Errors } {
  const errors: Errors = {};
  const symbol = normalizeSymbol(draft.symbol);
  if (!symbol) errors.symbol = 'Pick or type a pair.';
  else if (symbol.length > 32) errors.symbol = 'That is too long for a symbol.';

  const entry = parseNumber(draft.entryPrice);
  if (entry === null) errors.entryPrice = 'Enter the entry price.';
  else if (entry <= 0) errors.entryPrice = 'Must be above zero.';

  const close = parseNumber(draft.closePrice);
  if (close === null) errors.closePrice = 'Enter the close price.';
  else if (close <= 0) errors.closePrice = 'Must be above zero.';

  const lots = parseNumber(draft.lots);
  if (lots === null) errors.lots = 'Enter the size in lots.';
  else if (lots <= 0) errors.lots = 'Must be above zero.';

  const pnl = parseNumber(draft.pnl);
  if (pnl === null) errors.pnl = 'Enter the PnL — negative for a loss.';

  const openedAt = fromDateTimeLocalValue(draft.openedAt);
  if (!openedAt) errors.openedAt = 'Enter when it opened.';
  const closedAt = fromDateTimeLocalValue(draft.closedAt);
  if (!closedAt) errors.closedAt = 'Enter when it closed.';
  else if (openedAt && Date.parse(closedAt) < Date.parse(openedAt)) {
    errors.closedAt = 'Closes before it opens.';
  } else if (Date.parse(closedAt) > Date.now() + 60_000) {
    errors.closedAt = 'That is in the future.';
  }

  if (Object.keys(errors).length) return { input: null, errors };
  return {
    input: {
      source: base?.source ?? 'manual',
      externalId: base?.externalId ?? null,
      symbol,
      side: draft.side,
      entryPrice: entry!,
      closePrice: close!,
      lots: lots!,
      pnl: pnl!,
      openedAt,
      closedAt,
      note: draft.note.trim(),
    },
    errors,
  };
}

function PairPicker({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => {
    const needle = normalizeSymbol(value);
    return SYMBOL_SUGGESTIONS.filter((s) => s.includes(needle)).slice(0, 8);
  }, [value]);

  const pick = (symbol: string) => {
    onChange(symbol);
    setOpen(false);
  };

  return (
    <div className="jx-combo">
      <span className="jx-combo__logo">{value ? <SymbolLogo symbol={value} size={22} /> : null}</span>
      <input
        ref={inputRef}
        id="jx-pair"
        className={invalid ? 'is-invalid' : ''}
        value={value}
        autoComplete="off"
        placeholder="EURUSD"
        role="combobox"
        aria-expanded={open}
        aria-controls="jx-pair-list"
        onChange={(event) => {
          onChange(event.target.value.toUpperCase());
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (!open || options.length === 0) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((i) => (i + 1) % options.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => (i - 1 + options.length) % options.length);
          } else if (event.key === 'Enter') {
            const option = options[active];
            if (option) {
              event.preventDefault();
              pick(option);
            }
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && options.length > 0 ? (
        <ul className="jx-combo__list" id="jx-pair-list" role="listbox">
          {options.map((option, i) => (
            <li
              key={option}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onPointerDown={(event) => {
                event.preventDefault();
                pick(option);
              }}
              onPointerEnter={() => setActive(i)}
            >
              <SymbolLogo symbol={option} size={20} />
              {displaySymbol(option)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  wide = false,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`jx-field${wide ? ' jx-field--wide' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <span className="jx-field__error">{error}</span>
      ) : hint ? (
        <span className="jx-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function TradeFormModal({
  trade,
  currency,
  onClose,
}: {
  /** Null to add a new trade. */
  trade: Trade | null;
  currency: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(trade));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  // A loss typed as a profit is the commonest slip; say so, but let it save.
  const signWarning = useMemo(() => {
    const entry = parseNumber(draft.entryPrice);
    const close = parseNumber(draft.closePrice);
    const pnl = parseNumber(draft.pnl);
    if (entry === null || close === null || pnl === null || pnl === 0 || entry === close) return null;
    const priceSaysProfit = draft.side === 'buy' ? close > entry : close < entry;
    return priceSaysProfit !== pnl > 0
      ? `The prices say this ${draft.side} was a ${priceSaysProfit ? 'profit' : 'loss'}.`
      : null;
  }, [draft.closePrice, draft.entryPrice, draft.pnl, draft.side]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const { input, errors: found } = validate(draft, trade);
    setErrors(found);
    if (!input) return;
    setBusy(true);
    setFailure(null);
    try {
      if (trade) await updateTrade(trade.id, input);
      else await addTrade(input);
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The trade was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!trade) return;
    setBusy(true);
    setFailure(null);
    try {
      await deleteTrade(trade.id);
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The trade was not deleted.');
      setBusy(false);
    }
  };

  return (
    <Overlay label={trade ? 'Edit trade' : 'Add trade'} className="jx-form" onClose={onClose}>
      <header className="jx-dialog__head">
        <h2>{trade ? 'Edit trade' : 'Add trade'}</h2>
        {trade?.source === 'mt5' ? <span className="jx-chip">Synced from MT5</span> : null}
        <button type="button" className="jx-iconbtn" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </header>
      <form className="jx-form__grid" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Pair" htmlFor="jx-pair" error={errors.symbol}>
          <PairPicker value={draft.symbol} onChange={(v) => set('symbol', v)} invalid={!!errors.symbol} />
        </Field>
        <Field label="Direction" htmlFor="jx-side-buy">
          <div className="jx-toggle" role="group" aria-label="Direction">
            {(['buy', 'sell'] as const).map((side) => (
              <button
                key={side}
                id={`jx-side-${side}`}
                type="button"
                className={`jx-toggle__opt jx-toggle__opt--${side}${draft.side === side ? ' is-active' : ''}`}
                aria-pressed={draft.side === side}
                onClick={() => set('side', side)}
              >
                {side === 'buy' ? 'Buy' : 'Sell'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Entry price" htmlFor="jx-entry" error={errors.entryPrice}>
          <input id="jx-entry" inputMode="decimal" value={draft.entryPrice} className={errors.entryPrice ? 'is-invalid' : ''} onChange={(e) => set('entryPrice', e.target.value)} />
        </Field>
        <Field label="Close price" htmlFor="jx-close" error={errors.closePrice}>
          <input id="jx-close" inputMode="decimal" value={draft.closePrice} className={errors.closePrice ? 'is-invalid' : ''} onChange={(e) => set('closePrice', e.target.value)} />
        </Field>
        <Field label="Lots" htmlFor="jx-lots" error={errors.lots}>
          <input id="jx-lots" inputMode="decimal" value={draft.lots} className={errors.lots ? 'is-invalid' : ''} onChange={(e) => set('lots', e.target.value)} />
        </Field>
        <Field
          label={`PnL (${currency})`}
          htmlFor="jx-pnl"
          error={errors.pnl}
          hint={signWarning ?? 'As your broker reports it. MT5 sync will fill this in.'}
        >
          <input id="jx-pnl" inputMode="decimal" value={draft.pnl} className={errors.pnl ? 'is-invalid' : signWarning ? 'is-warn' : ''} onChange={(e) => set('pnl', e.target.value)} />
        </Field>
        <Field label="Opened" htmlFor="jx-opened" error={errors.openedAt}>
          <input id="jx-opened" type="datetime-local" value={draft.openedAt} className={errors.openedAt ? 'is-invalid' : ''} onChange={(e) => set('openedAt', e.target.value)} />
        </Field>
        <Field label="Closed" htmlFor="jx-closed" error={errors.closedAt}>
          <input id="jx-closed" type="datetime-local" value={draft.closedAt} className={errors.closedAt ? 'is-invalid' : ''} onChange={(e) => set('closedAt', e.target.value)} />
        </Field>
        <Field label="Note (optional)" htmlFor="jx-note" wide>
          <textarea id="jx-note" rows={2} value={draft.note} maxLength={500} onChange={(e) => set('note', e.target.value)} />
        </Field>

        {failure ? <p className="jx-form__failure" role="alert">{failure}</p> : null}

        <div className="jx-form__actions">
          {trade ? (
            confirmDelete ? (
              <span className="jx-confirm">
                Delete this trade?
                <button type="button" className="jx-btn jx-btn--danger" disabled={busy} onClick={() => void remove()}>
                  Delete
                </button>
                <button type="button" className="jx-btn jx-btn--ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="jx-btn jx-btn--ghost jx-btn--danger-text" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )
          ) : null}
          <span className="jx-spacer" />
          <button type="button" className="jx-btn jx-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="jx-btn jx-btn--accent" disabled={busy}>
            {busy ? 'Saving…' : trade ? 'Save' : 'Add trade'}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
