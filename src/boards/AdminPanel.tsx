import { useEffect, useRef, useState } from 'react';
import { DEFAULT_TIMEFRAME, TIMEFRAMES, TIMEFRAME_LABEL, type Timeframe } from './model';
import {
  BOARD_ACCEPT,
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
                      onFile={(file) => run(() => setFrame(p, tf, file))}
                      onLink={(imageUrl) => run(async () => setFrame(p, tf, await fetchChartImage(imageUrl)))}
                      onError={onError}
                      onRemove={() => run(() => removeFrame(p, tf))}
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
          <NewPositionField
            disabled={busy}
            onError={onError}
            onLink={(imageUrl) =>
              run(async () => {
                const file = await fetchChartImage(imageUrl);
                const id = await addPosition(category);
                const fresh: RawPosition = { id, categoryId: category.id, sort: 0, frames: {}, link: null };
                try {
                  await setFrame(fresh, DEFAULT_TIMEFRAME, file);
                } catch (error) {
                  await deletePosition(fresh).catch(() => undefined);
                  throw error;
                }
              })
            }
          />
          <button type="button" className="btn btn--small" disabled={busy} onClick={() => run(() => addPosition(category))}>
            Add empty position
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

/** Paste a chart link here and it becomes a new position, its picture in the 15M slot. */
function NewPositionField({
  disabled,
  onLink,
  onError,
}: {
  disabled: boolean;
  onLink(imageUrl: string): Promise<boolean>;
  onError(error: unknown): void;
}) {
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const submit = async (text: string) => {
    if (!text.trim()) return;
    const imageUrl = chartImageUrl(text);
    if (!imageUrl) {
      onError(new Error('Paste a TradingView snapshot link (tradingview.com/x/…) or a direct link to a picture.'));
      return;
    }
    setPreview(imageUrl);
    const ok = await onLink(imageUrl);
    setPreview(null);
    if (ok) setDraft('');
  };
  return (
    <div className="bd-admin__new">
      {preview ? <img className="bd-admin__new-preview" src={preview} alt="" /> : null}
      <input
        className="input bd-admin__new-link"
        value={draft}
        placeholder="Paste a TradingView link to add a position"
        disabled={disabled}
        aria-label="Chart link for a new position"
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (!chartImageUrl(text)) return;
          event.preventDefault();
          setDraft(text.trim());
          void submit(text);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit(draft);
          if (event.key === 'Escape') setDraft('');
        }}
      />
    </div>
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

function Slot({
  position,
  tf,
  disabled,
  onFile,
  onLink,
  onError,
  onRemove,
}: {
  position: RawPosition;
  tf: Timeframe;
  disabled: boolean;
  onFile(file: File): Promise<boolean>;
  onLink(imageUrl: string): Promise<boolean>;
  onError(error: unknown): void;
  onRemove(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const frame = position.frames[tf];
  const label = TIMEFRAME_LABEL[tf];
  /** Shown the moment something is pasted, until the saved copy replaces it. */
  const [preview, setPreview] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!preview?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const save = async (shown: string, work: () => Promise<boolean>) => {
    setPreview(shown);
    const ok = await work();
    setPreview(null);
    if (ok) setDraft('');
  };

  const fromFile = (file: File) => void save(URL.createObjectURL(file), () => onFile(file));

  const fromText = (text: string) => {
    if (!text.trim()) return;
    const imageUrl = chartImageUrl(text);
    if (!imageUrl) {
      onError(new Error('Paste a TradingView snapshot link (tradingview.com/x/…) or a direct link to a picture.'));
      return;
    }
    void save(imageUrl, () => onLink(imageUrl));
  };

  const shown = preview ?? (frame ? thumbUrl(frame) : null);
  return (
    <div className={`bd-slot${shown ? ' is-filled' : ''}${preview ? ' is-saving' : ''}`}>
      <button
        type="button"
        className="bd-slot__pick"
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-label={frame ? `Replace ${label} screenshot` : `Upload ${label} screenshot`}
      >
        {shown ? <img src={shown} alt="" /> : <span>+</span>}
        <em>{label}</em>
      </button>
      {frame && !preview ? (
        <button type="button" className="bd-slot__remove" disabled={disabled} onClick={onRemove} aria-label={`Remove ${label} screenshot`}>
          ×
        </button>
      ) : null}
      <input
        className="input bd-slot__link"
        value={draft}
        placeholder="Paste link"
        disabled={disabled}
        aria-label={`${label} chart link`}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event) => {
          const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith('image/'));
          const text = event.clipboardData.getData('text');
          if (!file && !chartImageUrl(text)) return; // let it paste as text; Enter will explain
          event.preventDefault();
          if (file) fromFile(file);
          else {
            setDraft(text.trim());
            fromText(text);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') fromText(draft);
          if (event.key === 'Escape') setDraft('');
        }}
      />
      <input
        ref={input}
        type="file"
        accept={BOARD_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) fromFile(file);
        }}
      />
    </div>
  );
}
