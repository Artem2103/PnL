import { useId, type ReactNode } from 'react';

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
