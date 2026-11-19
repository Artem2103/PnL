import { useEffect, useState } from 'react';
import { TIMEFRAMES, TIMEFRAME_LABEL, type Timeframe } from './model';
import {
  addCategory,
  addPosition,
  deleteCategory,
  deletePosition,
  removeFrame,
  renameCategory,
  setFrame,
  setLink,
  swapOrder,
  thumbUrl,
  type RawCategory,
  type RawPosition,
} from './repository';
import { chartImageUrl, fetchChartImage } from './links';

/**
 * Board management, for accounts in `board_admins` only. The database refuses
 * every write from anyone else, so this panel being hidden is a convenience,
 * not the protection.
 */

interface Props {
  raw: RawCategory[];
  showingDemo: boolean;
  onChanged(): Promise<void>;
  onError(error: unknown): void;
  onClose(): void;
}

export function AdminPanel({ raw, showingDemo, onChanged, onError, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(raw[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const category = raw.find((c) => c.id === selected) ?? null;

  useEffect(() => {
    if (!selected && raw[0]) setSelected(raw[0].id);
  }, [raw, selected]);

  /** Resolves true when the change was saved. */
  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      await work();
      await onChanged();
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="bd-admin" aria-label="Manage board">
      <header className="bd-admin__head">
        <h2>Manage board</h2>
        <button type="button" className="bv-icon" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </header>
      {showingDemo ? (
        <p className="bd-admin__note">The canvas shows the demo positions until the first screenshot is uploaded.</p>
      ) : null}

      <section className="bd-admin__section">
        <h3>Categories</h3>
        <ul className="bd-admin__list">
          {raw.map((c, i) => (
            <li key={c.id} className={`bd-admin__cat${c.id === selected ? ' is-selected' : ''}`}>
              <button type="button" className="bd-admin__pick" onClick={() => setSelected(c.id)} aria-label={`Edit ${c.name}`}>
                {c.positions.length}
              </button>
              <NameField
                value={c.name}
                disabled={busy}
                onSave={(name) => run(() => renameCategory(c.id, name))}
                onFocus={() => setSelected(c.id)}
              />
              <MoveButtons
                disabled={busy}
                onUp={i > 0 ? () => run(() => swapOrder('board_categories', c, raw[i - 1]!)) : null}
                onDown={i < raw.length - 1 ? () => run(() => swapOrder('board_categories', c, raw[i + 1]!)) : null}
              />
              <ConfirmButton disabled={busy} onConfirm={() => run(() => deleteCategory(c))} label={`Delete ${c.name}`} />
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn--small"
          disabled={busy}
          onClick={() => run(() => addCategory(nextLetter(raw), raw))}
        >
          Add category
        </button>
      </section>

      {category ? (
        <section className="bd-admin__section">
          <h3>Positions in {category.name}</h3>
          <ul className="bd-admin__list">
            {category.positions.map((p, i) => (
              <li key={p.id} className="bd-admin__pos">
                <span className="bd-admin__num">{String(i + 1).padStart(2, '0')}</span>
                <div className="bd-admin__slots">
                  {TIMEFRAMES.map((tf) => (
                    <Slot
                      key={tf}
                      position={p}
                      tf={tf}
                      disabled={busy}
                      onLink={(imageUrl, link) => run(async () => setFrame(p, tf, await fetchChartImage(imageUrl), link))}
                      onRemove={() => run(() => removeFrame(p, tf))}
                      onError={onError}
                    />
                  ))}
                </div>
                <LinkField value={p.link ?? ''} disabled={busy} onSave={(link) => run(() => setLink(p, link))} />
                <MoveButtons
                  disabled={busy}
                  onUp={i > 0 ? () => run(() => swapOrder('board_positions', p, category.positions[i - 1]!)) : null}
                  onDown={
                    i < category.positions.length - 1
                      ? () => run(() => swapOrder('board_positions', p, category.positions[i + 1]!))
                      : null
                  }
                />
                <ConfirmButton disabled={busy} onConfirm={() => run(() => deletePosition(p))} label="Delete position" />
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn--small" disabled={busy} onClick={() => run(() => addPosition(category))}>
            Add position
          </button>
        </section>
      ) : null}
      {busy ? <p className="bd-admin__busy" role="status">Saving…</p> : null}
    </aside>
  );
}

function nextLetter(raw: RawCategory[]): string {
  const used = new Set(raw.map((c) => c.name));
  for (let i = 0; i < 26; i += 1) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return `Category ${raw.length + 1}`;
}

function NameField({
  value,
  disabled,
  onSave,
  onFocus,
}: {
  value: string;
  disabled: boolean;
  onSave(name: string): void;
  onFocus(): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const name = draft.trim().slice(0, 40);
    if (!name) setDraft(value);
    else if (name !== value) onSave(name);
  };
  return (
    <input
      className="input bd-admin__name"
      value={draft}
      maxLength={40}
      disabled={disabled}
      aria-label="Category name"
      onFocus={onFocus}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') setDraft(value);
      }}
    />
  );
}

function LinkField({ value, disabled, onSave }: { value: string; disabled: boolean; onSave(link: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="input bd-admin__link"
      value={draft}
      placeholder="Telegram link"
      disabled={disabled}
      aria-label="Telegram link"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() !== value) onSave(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') setDraft(value);
      }}
    />
  );
}

function MoveButtons({ disabled, onUp, onDown }: { disabled: boolean; onUp: (() => void) | null; onDown: (() => void) | null }) {
  return (
    <span className="bd-admin__move">
      <button type="button" className="bd-admin__mini" disabled={disabled || !onUp} onClick={onUp ?? undefined} aria-label="Move up">
        ↑
      </button>
      <button type="button" className="bd-admin__mini" disabled={disabled || !onDown} onClick={onDown ?? undefined} aria-label="Move down">
        ↓
      </button>
    </span>
  );
}

/** Two clicks to delete: the first arms it for a few seconds. */
function ConfirmButton({ disabled, onConfirm, label }: { disabled: boolean; onConfirm(): void; label: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      className={`bd-admin__mini bd-admin__del${armed ? ' is-armed' : ''}`}
      disabled={disabled}
      aria-label={armed ? `${label}: click again to confirm` : label}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? 'Delete?' : '×'}
    </button>
  );
}

/**
 * One timeframe of a position: a grey preview box (empty, or the picture) with
 * the chart link under it. The link is the only way in: pasting it fills the
 * box, emptying it clears the box.
 */
function Slot({
  position,
  tf,
  disabled,
  onLink,
  onRemove,
  onError,
}: {
  position: RawPosition;
  tf: Timeframe;
  disabled: boolean;
  onLink(imageUrl: string, link: string): Promise<boolean>;
  onRemove(): Promise<boolean>;
  onError(error: unknown): void;
}) {
  const frame = position.frames[tf];
  const label = TIMEFRAME_LABEL[tf];
  const value = frame?.source ?? '';
  const [draft, setDraft] = useState(value);
  /** The pasted picture, shown at once until the saved copy replaces it. */
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setDraft(value), [value]);

  const submit = async (text: string) => {
    const link = text.trim();
    if (link === value) return;
    if (!link) {
      if (frame && !(await onRemove())) setDraft(value);
      return;
    }
    const imageUrl = chartImageUrl(link);
    if (!imageUrl) {
      onError(new Error('Paste a TradingView (tradingview.com/x/…) or FX Replay (fxreplay.com/s/…) link, or a direct link to a picture.'));
      setDraft(value);
      return;
    }
    setPending(imageUrl);
    const ok = await onLink(imageUrl, link);
    setPending(null);
    if (!ok) setDraft(value);
  };

  const shown = pending ?? (frame ? thumbUrl(frame) : null);
  return (
    <div className={`bd-slot${shown ? ' is-filled' : ''}${pending ? ' is-saving' : ''}`}>
      <div className="bd-slot__pick" aria-label={shown ? `${label} picture` : `${label} empty`}>
        {shown ? <img src={shown} alt="" /> : null}
        <em>{label}</em>
      </div>
      <input
        className="input bd-slot__link"
        value={draft}
        placeholder="TradingView / FX Replay link"
        disabled={disabled}
        aria-label={`${label} chart link`}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (!chartImageUrl(text)) return;
          event.preventDefault();
          setDraft(text.trim());
          void submit(text);
        }}
        onBlur={() => void submit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraft(value);
        }}
      />
    </div>
  );
}
