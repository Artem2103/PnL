import { useEffect, useRef, useState } from 'react';
import { TIMEFRAMES, TIMEFRAME_LABEL, type Timeframe } from './model';
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

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      await onChanged();
    } catch (error) {
      onError(error);
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

function Slot({
  position,
  tf,
  disabled,
  onFile,
  onRemove,
}: {
  position: RawPosition;
  tf: Timeframe;
  disabled: boolean;
  onFile(file: File): void;
  onRemove(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const frame = position.frames[tf];
  return (
    <div className={`bd-slot${frame ? ' is-filled' : ''}`}>
      <button
        type="button"
        className="bd-slot__pick"
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-label={frame ? `Replace ${TIMEFRAME_LABEL[tf]} screenshot` : `Upload ${TIMEFRAME_LABEL[tf]} screenshot`}
      >
        {frame ? <img src={thumbUrl(frame)} alt="" /> : <span>+</span>}
        <em>{TIMEFRAME_LABEL[tf]}</em>
      </button>
      {frame ? (
        <button type="button" className="bd-slot__remove" disabled={disabled} onClick={onRemove} aria-label={`Remove ${TIMEFRAME_LABEL[tf]} screenshot`}>
          ×
        </button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={BOARD_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </div>
  );
}
