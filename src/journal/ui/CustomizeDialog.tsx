import { useState } from 'react';
import type { ArtworkState, BrandState, CardState, DisplayState } from '../../types';
import { ControlPanel, type BackgroundInfo } from '../../components/ControlPanel';
import { resolveTheme } from '../../lib/themes';
import { PALETTE } from '../../lib/canvas/spec';
import { normaliseHex } from '../../lib/color';
import { Overlay } from './Overlay';
import { CloseIcon } from './icons';

/** A colour that follows the template until it is set: swatch, hex, and a reset. */
function ColourField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | null;
  fallback: string;
  onChange: (hex: string | null) => void;
}) {
  const shown = (value ?? fallback).toUpperCase();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="jx-cz__row">
      <span>{label}</span>
      <label className="jx-colour">
        <span className="jx-colour__swatch" style={{ background: shown }}>
          <input
            type="color"
            value={shown.length === 7 ? shown.toLowerCase() : '#ffffff'}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            aria-label={`${label} colour`}
          />
        </span>
        <input
          className="jx-colour__hex"
          value={draft ?? shown.replace('#', '')}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label} hex`}
          onChange={(event) => {
            setDraft(event.target.value);
            const hex = normaliseHex(event.target.value.startsWith('#') ? event.target.value : `#${event.target.value}`);
            if (hex) onChange(hex);
          }}
          onBlur={() => setDraft(null)}
        />
        <button
          type="button"
          className="jx-colour__reset"
          onClick={() => onChange(null)}
          title="Back to the template's colour"
          aria-label={`Reset ${label}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
          </svg>
        </button>
      </label>
    </div>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="jx-cz__row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`jx-switch${checked ? ' is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

/**
 * "Customize Share PNL", laid out like the reference: text colour, PnL
 * colours, layout switches, the rectangle's text colour, and Continue. Under
 * it, everything the card editor can do — backgrounds and their placement,
 * colour themes, avatar, frames, wordmark, handle, footer — so nothing has to
 * be done on another page.
 */
export function CustomizeDialog({
  state,
  background,
  isTrade,
  patchDisplay,
  patchBrand,
  patchArtwork,
  setAvatarId,
  onError,
  onClose,
}: {
  state: CardState;
  background: BackgroundInfo | null;
  isTrade: boolean;
  patchDisplay: (patch: Partial<DisplayState>) => void;
  patchBrand: (patch: Partial<BrandState>) => void;
  patchArtwork: (patch: Partial<ArtworkState>) => void;
  setAvatarId: (id: string | null) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const [more, setMore] = useState(false);
  const d = state.display;
  const theme = resolveTheme(d);
  const ink = d.textTone === 'dark' ? PALETTE.textDark : PALETTE.text;

  return (
    <Overlay label="Customize share card" className="jx-cz" onClose={onClose}>
      <header className="jx-cz__head">
        <h2>Customize Share PNL</h2>
        <button type="button" className="jx-iconbtn" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </header>
      <div className="jx-cz__body">
        <h3>Text Colors</h3>
        <ColourField label="Main Text" value={d.textColor} fallback={ink} onChange={(textColor) => patchDisplay({ textColor })} />

        <h3>PNL Colors</h3>
        <ColourField
          label="Positive PNL"
          value={d.profitColor}
          fallback={theme.accent}
          onChange={(profitColor) => patchDisplay({ profitColor })}
        />
        <ColourField
          label="Negative PNL"
          value={d.lossColor}
          fallback={theme.loss}
          onChange={(lossColor) => patchDisplay({ lossColor })}
        />

        <h3>Layout Options</h3>
        <Switch label="Use bold font weight" checked={d.boldText} onChange={(boldText) => patchDisplay({ boldText })} />
        <Switch label="Use text shadows" checked={d.textShadow} onChange={(textShadow) => patchDisplay({ textShadow })} />
        <Switch
          label="Show colored PNL rectangle"
          checked={d.showBlock}
          onChange={(showBlock) => patchDisplay({ showBlock })}
        />
        <Switch
          label={isTrade ? 'Show token image' : 'Show token image (trade cards)'}
          checked={d.showTokenImage}
          onChange={(showTokenImage) => patchDisplay({ showTokenImage })}
        />
        <ColourField
          label="Rectangle Text Color"
          value={d.blockTextColor}
          fallback={PALETTE.onAccent}
          onChange={(blockTextColor) => patchDisplay({ blockTextColor })}
        />

        <p className="jx-cz__note">
          These settings apply to every card. A color left at its default follows the template.
        </p>

        <button
          type="button"
          className={`jx-cz__more${more ? ' is-open' : ''}`}
          onClick={() => setMore((open) => !open)}
          aria-expanded={more}
        >
          More settings
          <span>Background, placement, colours, avatar, frame, handle</span>
        </button>
        {more ? (
          <div className="jx-cz__editor">
            <ControlPanel
              state={state}
              background={background}
              hideNumbers
              hideStyle
              hideBackgroundPicker
              setMode={() => undefined}
              patchTrade={() => undefined}
              patchPeriod={() => undefined}
              patchBrand={patchBrand}
              patchDisplay={patchDisplay}
              patchArtwork={patchArtwork}
              setAvatarId={setAvatarId}
              onError={onError}
            />
          </div>
        ) : null}
      </div>
      <footer className="jx-cz__foot">
        <button type="button" className="jx-cz__continue" onClick={onClose}>
          Continue
        </button>
      </footer>
    </Overlay>
  );
}
