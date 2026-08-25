import { useEffect, useId, useState, type ReactNode } from 'react';
import { hexToRgb, normaliseHex, rgbToHex } from '../lib/color';

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section__head">
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </div>
      <div className="section__body">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {hint ? <em>{hint}</em> : null}
      </span>
      {children}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  maxLength = 48,
  spellCheck = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  spellCheck?: boolean;
}) {
  return (
    <input
      className="input"
      type="text"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      spellCheck={spellCheck}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * Number field that keeps the raw string while typing, so intermediate values
 * like "0." or "-" don't get clobbered mid-keystroke.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 'any',
  suffix,
  placeholder,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <span className={suffix ? 'input-wrap input-wrap--suffix' : 'input-wrap'}>
      <input
        className="input input--number"
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? String(value) : ''}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (Number.isNaN(next)) {
            onChange(0);
            return;
          }
          const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
          onChange(clamped);
        }}
      />
      {suffix ? <span className="input-suffix">{suffix}</span> : null}
    </span>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
  tone?: 'profit' | 'loss';
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={[
            'segmented__item',
            value === option.value ? 'is-active' : '',
            option.tone ? `is-${option.tone}` : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="toggle">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id}>
        <span className="toggle__track" aria-hidden="true">
          <span className="toggle__thumb" />
        </span>
        <span className="toggle__label">{label}</span>
      </label>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider">
      <span className="slider__head">
        <span>{label}</span>
        <em>{format ? format(value) : value}</em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </label>
  );
}

/**
 * Any colour at all: the OS picker, a hex field and three channels.
 *
 * Three ways in rather than one because they fail differently — the native
 * well is the fastest way to land somewhere close, the channels are the only
 * way to nudge one dimension without disturbing the others, and the hex field
 * is how a brand colour gets pasted in.
 */
export function RgbPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (hex: string) => void;
  label: string;
}) {
  const rgb = hexToRgb(value) ?? { r: 255, g: 255, b: 255 };
  const [draft, setDraft] = useState(value);

  // Follow the colour when it changes from the well or the sliders, but leave
  // a half-typed hex alone: if what is in the field already means `value`,
  // rewriting it would fight the caret and helpfully uppercase mid-word.
  useEffect(() => {
    setDraft((current) => (normaliseHex(current) === value ? current : value));
  }, [value]);

  const channel = (key: 'r' | 'g' | 'b') => (next: number) =>
    onChange(rgbToHex({ ...rgb, [key]: next }));

  return (
    <div className="rgb">
      <div className="rgb__row">
        <input
          className="rgb__well"
          type="color"
          value={value}
          aria-label={label}
          onChange={(event) => onChange(normaliseHex(event.target.value) ?? value)}
        />
        <input
          className="input rgb__hex"
          type="text"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          aria-label={`${label}, hex`}
          onChange={(event) => {
            setDraft(event.target.value);
            const hex = normaliseHex(event.target.value);
            if (hex) onChange(hex);
          }}
          // Anything unparseable snaps back rather than sitting there looking
          // like it took effect.
          onBlur={() => setDraft(value)}
        />
      </div>
      <div className="sliders">
        <Slider
          label="Red"
          value={rgb.r}
          min={0}
          max={255}
          step={1}
          format={(v) => String(Math.round(v))}
          onChange={channel('r')}
        />
        <Slider
          label="Green"
          value={rgb.g}
          min={0}
          max={255}
          step={1}
          format={(v) => String(Math.round(v))}
          onChange={channel('g')}
        />
        <Slider
          label="Blue"
          value={rgb.b}
          min={0}
          max={255}
          step={1}
          format={(v) => String(Math.round(v))}
          onChange={channel('b')}
        />
      </div>
    </div>
  );
}
