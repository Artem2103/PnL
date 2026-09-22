import { useCallback, useMemo } from 'react';
import type {
  ArtworkState,
  BrandState,
  CardMode,
  CardState,
  DisplayState,
  PeriodState,
  TradeState,
} from '../types';
import { CUSTOM_THEME_ID, THEMES, resolveTheme } from '../lib/themes';
import { ensureContrast } from '../lib/color';
import { frameById } from '../lib/frames';
import { GROUND, PALETTE } from '../lib/canvas/spec';
import { FramePicker } from './FramePicker';
import { ScenePicker } from './ScenePicker';
import { approximateLiquidationPrice, computeCard, signsDisagree } from '../lib/pnl';
import { buildContent, FOOTER_SECONDARY, PERIOD_PRESETS } from '../lib/content';
import { formatPrice } from '../lib/format';
import { MAX_CLIP_SECONDS, MAX_SOURCE_SECONDS } from '../lib/images';
import { resolveClip } from '../lib/video';
import { ImagePicker } from './ImagePicker';
import { Field, NumberInput, RgbPicker, Section, Segmented, Slider, TextInput, Toggle } from './ui';

/**
 * Hoisted out of the render: it never changes, and a fresh string every
 * keystroke would defeat the memo on the picker below.
 */
const ARTWORK_HINT =
  `Drop a file or click to browse — photos, or a clip up to ${MAX_SOURCE_SECONDS} s ` +
  `(the card plays ${MAX_CLIP_SECONDS} s of it). Files stay on this device: they are ` +
  `stored in your browser and never uploaded.`;

/** What the selected background turned out to be, once decoded. */
export interface BackgroundInfo {
  kind: 'image' | 'video';
  duration: number;
}

export interface ControlPanelProps {
  state: CardState;
  background: BackgroundInfo | null;
  setMode: (mode: CardMode) => void;
  patchTrade: (patch: Partial<TradeState>) => void;
  patchPeriod: (patch: Partial<PeriodState>) => void;
  patchBrand: (patch: Partial<BrandState>) => void;
  patchDisplay: (patch: Partial<DisplayState>) => void;
  patchArtwork: (patch: Partial<ArtworkState>) => void;
  setAvatarId: (id: string | null) => void;
  onError: (message: string) => void;
}

export function ControlPanel({
  state,
  background,
  setMode,
  patchTrade,
  patchPeriod,
  patchBrand,
  patchDisplay,
  patchArtwork,
  setAvatarId,
  onError,
}: ControlPanelProps) {
  const { trade, period, brand, display, artwork } = state;
  const result = useMemo(() => computeCard(state), [state]);
  const content = useMemo(() => buildContent(state, result), [state, result]);
  const liquidation = state.mode === 'trade' ? approximateLiquidationPrice(trade) : null;
  const mismatch = state.mode === 'trade' && signsDisagree(trade);
  const isVideo = background?.kind === 'video';
  const clip = resolveClip(background?.duration ?? 0, artwork.clipStart, artwork.clipLength);
  // Leave at least a second of clip after the start point, or the window is empty.
  const maxStart = Math.max(0, (background?.duration ?? 0) - 1);
  const isCustom = display.themeId === CUSTOM_THEME_ID;
  const frame = frameById(display.frameId);
  // What the frame tiles paint with: the same accent and ink the card would
  // use right now, so a halo in the picker is the halo on the card.
  const theme = resolveTheme(display);
  const tileInk = display.textTone === 'dark' ? PALETTE.textDark : PALETTE.text;
  const tileAccent = ensureContrast(
    result.isProfit ? theme.accent : theme.loss,
    (display.textTone === 'dark' ? GROUND.light : GROUND.dark)[1],
  );

  // Stable identity, so the memoised pickers sit out every unrelated re-render.
  // Each picker clears the other's choice: the card has one background, and
  // leaving a scene set under an upload would make picking None jump back to it.
  const selectArtwork = useCallback(
    (imageId: string | null) => patchArtwork(imageId ? { imageId, sceneId: null } : { imageId }),
    [patchArtwork],
  );
  const selectScene = useCallback(
    (sceneId: string | null) => patchArtwork(sceneId ? { sceneId, imageId: null } : { sceneId }),
    [patchArtwork],
  );

  return (
    <div className="controls">
      <Section title="Numbers" hint="What the card is about.">
        <Field label="Card">
          <Segmented
            ariaLabel="Card type"
            value={state.mode}
            onChange={setMode}
            options={[
              { value: 'period', label: 'Period' },
              { value: 'trade', label: 'Trade' },
            ]}
          />
        </Field>

        {state.mode === 'period' ? (
          <>
            {/*
              Not a `Field`: two controls under one <label> would make a click
              on the word "Title" press the first preset. Same markup, same
              styling, a plain <span> for the label.
            */}
            <div className="field">
              <span className="field__label">
                Title<em>the heading above the block</em>
              </span>
              <div className="presets">
                <Segmented
                  ariaLabel="Period preset"
                  value={period.title}
                  onChange={(title) => patchPeriod({ title })}
                  options={PERIOD_PRESETS.map((preset) => ({ value: preset, label: preset }))}
                />
              </div>
              <TextInput
                ariaLabel="Title"
                value={period.title}
                onChange={(title) => patchPeriod({ title })}
                placeholder="August 2026"
                maxLength={28}
              />
            </div>
            <div className="grid grid--2">
              <Field label="Start balance">
                <NumberInput
                  value={period.startBalance}
                  onChange={(startBalance) => patchPeriod({ startBalance })}
                />
              </Field>
              <Field label="End balance">
                <NumberInput
                  value={period.endBalance}
                  onChange={(endBalance) => patchPeriod({ endBalance })}
                />
              </Field>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid--2">
              <Field label="Symbol">
                <TextInput
                  value={trade.symbol}
                  onChange={(symbol) => patchTrade({ symbol })}
                  placeholder="BTCUSDT"
                  maxLength={20}
                />
              </Field>
              <Field label="Leverage">
                <NumberInput
                  value={trade.leverage}
                  onChange={(leverage) => patchTrade({ leverage })}
                  min={1}
                  max={200}
                  step={1}
                  suffix="×"
                />
              </Field>
            </div>
            <Field label="Direction">
              <Segmented
                ariaLabel="Direction"
                value={trade.direction}
                onChange={(direction) => patchTrade({ direction })}
                options={[
                  { value: 'long', label: 'Long', tone: 'profit' },
                  { value: 'short', label: 'Short', tone: 'loss' },
                ]}
              />
            </Field>
            <div className="grid grid--2">
              <Field label="Entry price">
                <NumberInput
                  value={trade.entryPrice}
                  onChange={(entryPrice) => patchTrade({ entryPrice })}
                  min={0}
                />
              </Field>
              <Field label="Exit price">
                <NumberInput
                  value={trade.exitPrice}
                  onChange={(exitPrice) => patchTrade({ exitPrice })}
                  min={0}
                />
              </Field>
            </div>
            <Field label="Profit / loss" hint={`in ${brand.currency.trim() || 'quote'}`}>
              <NumberInput value={trade.pnl} onChange={(pnl) => patchTrade({ pnl })} />
            </Field>
            {mismatch ? (
              <p className="warn">
                You entered a {trade.pnl > 0 ? 'profit' : 'loss'}, but a {trade.direction} from{' '}
                {formatPrice(trade.entryPrice)} to {formatPrice(trade.exitPrice)} is a{' '}
                {trade.pnl > 0 ? 'loss' : 'profit'}. Check the direction or the prices.
              </p>
            ) : null}
            <Toggle
              label="Show direction and leverage in the title"
              checked={trade.showDirectionInTitle}
              onChange={(showDirectionInTitle) => patchTrade({ showDirectionInTitle })}
            />
          </>
        )}

        <div className="grid grid--2">
          <Field label="Currency">
            <TextInput
              value={brand.currency}
              onChange={(currency) => patchBrand({ currency })}
              placeholder="USD"
              maxLength={6}
            />
          </Field>
          <Field label="Big value">
            <Segmented
              ariaLabel="Hero value format"
              value={display.compactHero ? 'compact' : 'full'}
              onChange={(value) => patchDisplay({ compactHero: value === 'compact' })}
              options={[
                { value: 'compact', label: '$10.1K' },
                { value: 'full', label: '$10,120' },
              ]}
            />
          </Field>
        </div>

        <dl className="readout">
          <div>
            <dt>Block</dt>
            <dd className={result.isProfit ? 'is-profit' : 'is-loss'}>{content.hero}</dd>
          </div>
          <div>
            <dt>PNL</dt>
            <dd className={result.isProfit ? 'is-profit' : 'is-loss'}>{content.rows[0]?.value}</dd>
          </div>
          {liquidation ? (
            <div>
              <dt>Est. liq.</dt>
              <dd className="is-muted">{formatPrice(liquidation)}</dd>
            </div>
          ) : null}
        </dl>
        {result.degenerate ? (
          <p className="warn">
            {state.mode === 'trade'
              ? 'Enter an entry price above zero to compute the percentage.'
              : 'Enter a start balance above zero to compute a result.'}
          </p>
        ) : null}
      </Section>

      <Section title="Colour" hint="The block, the percentage and the ink.">
        <div className="theme-grid">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`theme-swatch${display.themeId === theme.id ? ' is-selected' : ''}`}
              style={{ background: theme.swatch }}
              onClick={() => patchDisplay({ themeId: theme.id })}
              aria-pressed={display.themeId === theme.id}
              title={theme.name}
            >
              <span className="theme-swatch__name">{theme.name}</span>
            </button>
          ))}
          <button
            type="button"
            className={`theme-swatch${isCustom ? ' is-selected' : ''}`}
            style={{ background: display.customAccent }}
            onClick={() => patchDisplay({ themeId: CUSTOM_THEME_ID })}
            aria-pressed={isCustom}
            title="Any colour you like"
          >
            <span className="theme-swatch__name">Custom</span>
          </button>
        </div>

        {isCustom ? (
          <div className="subsection">
            <RgbPicker
              label="Accent colour"
              value={display.customAccent}
              onChange={(customAccent) => patchDisplay({ customAccent })}
            />
            <p className="muted-note">
              A custom colour is used whether the card is up or down — the presets swap to red on a
              loss, this one stays the colour you picked. The big value flips between black and
              white on its own, whichever reads better on it.
            </p>
          </div>
        ) : null}

        <Field label="Text" hint="everything outside the block">
          <Segmented
            ariaLabel="Text colour"
            value={display.textTone}
            onChange={(textTone) => patchDisplay({ textTone })}
            options={[
              { value: 'light', label: 'White' },
              { value: 'dark', label: 'Black' },
            ]}
          />
        </Field>
        <p className="muted-note">
          Black text turns the whole card over: the plain background goes light and the scrim over a
          photo lightens instead of darkening, so the words stay readable either way.
        </p>
      </Section>

      <Section title="Background" hint="One of ours, or a photo or clip of yours.">
        <Field label="Built in" hint="drawn by the app, no upload">
          <ScenePicker value={artwork.sceneId} onChange={selectScene} />
        </Field>
        <Field label="Yours">
          <ImagePicker
            role="artwork"
            selectedId={artwork.imageId}
            onSelect={selectArtwork}
            onError={onError}
            emptyLabel="None"
            hint={ARTWORK_HINT}
          />
        </Field>
        {artwork.imageId || artwork.sceneId ? (
          <div className="sliders">
            <Slider
              label="Text scrim"
              value={artwork.scrim}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(scrim) => patchArtwork({ scrim })}
            />
          </div>
        ) : null}
        {artwork.imageId ? (
          <>
            <div className="subsection">
              <div className="subsection__head">
                <h3>Placement</h3>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => patchArtwork({ zoom: 1, offsetX: 0, offsetY: 0 })}
                  disabled={artwork.zoom === 1 && artwork.offsetX === 0 && artwork.offsetY === 0}
                >
                  Recentre
                </button>
              </div>
              <div className="sliders">
                <Slider
                  label="Zoom"
                  value={artwork.zoom}
                  min={1}
                  max={3}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)}×`}
                  onChange={(zoom) => patchArtwork({ zoom })}
                />
                <Slider
                  label="Horizontal"
                  value={artwork.offsetX}
                  min={-1}
                  max={1}
                  step={0.01}
                  format={(v) =>
                    v === 0 ? 'centre' : v > 0 ? `right ${Math.round(v * 100)}%` : `left ${Math.round(-v * 100)}%`
                  }
                  onChange={(offsetX) => patchArtwork({ offsetX })}
                />
                <Slider
                  label="Vertical"
                  value={artwork.offsetY}
                  min={-1}
                  max={1}
                  step={0.01}
                  format={(v) =>
                    v === 0 ? 'centre' : v > 0 ? `down ${Math.round(v * 100)}%` : `up ${Math.round(-v * 100)}%`
                  }
                  onChange={(offsetY) => patchArtwork({ offsetY })}
                />
              </div>
              <p className="muted-note">
                Drag the preview to move the background. Vertical only bites once the zoom leaves
                something to move into.
              </p>
            </div>

            {isVideo ? (
              <div className="subsection">
                <div className="subsection__head">
                  <h3>Clip</h3>
                  <span className="muted-note">
                    {clip.length.toFixed(1)} s of {(background?.duration ?? 0).toFixed(1)} s
                  </span>
                </div>
                <div className="sliders">
                  <Slider
                    label="Start at"
                    value={Math.min(artwork.clipStart, maxStart)}
                    min={0}
                    max={Math.max(maxStart, 0.1)}
                    step={0.1}
                    format={(v) => `${v.toFixed(1)} s`}
                    onChange={(clipStart) => patchArtwork({ clipStart })}
                  />
                  <Slider
                    label="Length"
                    value={Math.min(artwork.clipLength, MAX_CLIP_SECONDS)}
                    min={1}
                    max={MAX_CLIP_SECONDS}
                    step={0.5}
                    format={(v) => `${Math.min(v, clip.length).toFixed(1)} s`}
                    onChange={(clipLength) => patchArtwork({ clipLength })}
                  />
                </div>
                <Toggle
                  label="Keep the clip's audio in the exported video"
                  checked={!artwork.muteAudio}
                  onChange={(keep) => patchArtwork({ muteAudio: !keep })}
                />
                <p className="muted-note">
                  The numbers, rows and colours are painted over every frame by the same renderer
                  that makes the PNG — only the background moves.
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title="Identity" hint="Your marks, not anyone else's.">
        <Field label="Wordmark" hint="top right">
          <TextInput
            value={brand.wordmark}
            onChange={(wordmark) => patchBrand({ wordmark })}
            placeholder="Empty hides it"
            maxLength={18}
          />
        </Field>
        <Field label="Handle">
          <TextInput
            value={brand.handle}
            onChange={(handle) => patchBrand({ handle })}
            placeholder="@yourhandle"
            maxLength={24}
          />
        </Field>
        <Field label="Footer left" hint={`beside it, always: “${FOOTER_SECONDARY}”`}>
          <TextInput
            value={brand.footerPrimary}
            onChange={(footerPrimary) => patchBrand({ footerPrimary })}
            placeholder="yoursite.com"
            maxLength={28}
          />
        </Field>

        <Field label="Avatar">
          <ImagePicker
            role="avatar"
            selectedId={state.avatarId}
            onSelect={setAvatarId}
            onError={onError}
            emptyLabel="None"
          />
        </Field>
        <Field label="Avatar frame" hint="rises above the slot on some">
          <FramePicker
            value={display.frameId}
            frameColor={display.frameColor}
            accent={tileAccent}
            ink={tileInk}
            onChange={(frameId) => patchDisplay({ frameId })}
          />
        </Field>
        {frame.colourable ? (
          <div className="subsection">
            <RgbPicker
              label="Frame colour"
              value={display.frameColor}
              onChange={(frameColor) => patchDisplay({ frameColor })}
            />
            <p className="muted-note">
              One colour sets the whole badge: the ring’s shading, the pip and its highlight are
              worked out from it, the way the original red is.
            </p>
          </div>
        ) : null}
        <div className="toggles">
          <Toggle
            label="Wordmark"
            checked={display.showWordmark}
            onChange={(showWordmark) => patchDisplay({ showWordmark })}
          />
          <Toggle
            label="Logo mark"
            checked={display.showLogo}
            onChange={(showLogo) => patchDisplay({ showLogo })}
          />
          <Toggle
            label="Stat rows"
            checked={display.showRows}
            onChange={(showRows) => patchDisplay({ showRows })}
          />
          <Toggle
            label="Handle"
            checked={display.showHandle}
            onChange={(showHandle) => patchDisplay({ showHandle })}
          />
          <Toggle
            label="Footer"
            checked={display.showFooter}
            onChange={(showFooter) => patchDisplay({ showFooter })}
          />
        </div>
      </Section>
    </div>
  );
}
