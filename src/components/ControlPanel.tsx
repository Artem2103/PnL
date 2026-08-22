import type {
  ArtworkState,
  BrandState,
  CardMode,
  CardState,
  DisplayState,
  PeriodState,
  TradeState,
} from '../types';
import { THEMES } from '../lib/themes';
import { approximateLiquidationPrice, computeCard, signsDisagree } from '../lib/pnl';
import { buildContent } from '../lib/content';
import { formatPrice } from '../lib/format';
import { ImagePicker } from './ImagePicker';
import { Field, NumberInput, Section, Segmented, Slider, TextInput, Toggle } from './ui';

export interface ControlPanelProps {
  state: CardState;
  setMode: (mode: CardMode) => void;
  patchTrade: (patch: Partial<TradeState>) => void;
  patchPeriod: (patch: Partial<PeriodState>) => void;
  patchBrand: (patch: Partial<BrandState>) => void;
  patchDisplay: (patch: Partial<DisplayState>) => void;
  patchArtwork: (patch: Partial<ArtworkState>) => void;
  setAvatarId: (id: string | null) => void;
  setLogoId: (id: string | null) => void;
  onError: (message: string) => void;
}

export function ControlPanel({
  state,
  setMode,
  patchTrade,
  patchPeriod,
  patchBrand,
  patchDisplay,
  patchArtwork,
  setAvatarId,
  setLogoId,
  onError,
}: ControlPanelProps) {
  const { trade, period, brand, display, artwork } = state;
  const result = computeCard(state);
  const content = buildContent(state, result);
  const liquidation = state.mode === 'trade' ? approximateLiquidationPrice(trade) : null;
  const mismatch = state.mode === 'trade' && signsDisagree(trade);

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
            <Field label="Title" hint="the heading above the block">
              <TextInput
                value={period.title}
                onChange={(title) => patchPeriod({ title })}
                placeholder="August 2026"
                maxLength={28}
              />
            </Field>
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

      <Section title="Accent" hint="Colour of the block and the percentage.">
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
        </div>
      </Section>

      <Section title="Artwork" hint="Fills the right side. Stored in this browser only.">
        <ImagePicker
          role="artwork"
          selectedId={artwork.imageId}
          onSelect={(imageId) => patchArtwork({ imageId })}
          onError={onError}
          emptyLabel="None"
          hint="Drop a file or click to browse. Images stay on this device — they are stored in your browser and never uploaded."
        />
        {artwork.imageId ? (
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
            <Slider
              label="Zoom"
              value={artwork.zoom}
              min={1}
              max={2}
              step={0.01}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(zoom) => patchArtwork({ zoom })}
            />
            <Slider
              label="Pan"
              value={artwork.offsetX}
              min={-1}
              max={1}
              step={0.01}
              format={(v) => (v === 0 ? 'centre' : v > 0 ? `right ${Math.round(v * 100)}%` : `left ${Math.round(-v * 100)}%`)}
              onChange={(offsetX) => patchArtwork({ offsetX })}
            />
          </div>
        ) : null}
      </Section>

      <Section title="Identity" hint="Your marks, not anyone else's.">
        <Field label="Wordmark" hint="top right">
          <TextInput
            value={brand.wordmark}
            onChange={(wordmark) => patchBrand({ wordmark })}
            placeholder="STUDIO"
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
        <div className="grid grid--2">
          <Field label="Footer left">
            <TextInput
              value={brand.footerPrimary}
              onChange={(footerPrimary) => patchBrand({ footerPrimary })}
              placeholder="yoursite.com"
              maxLength={28}
            />
          </Field>
          <Field label="Footer right">
            <TextInput
              value={brand.footerSecondary}
              onChange={(footerSecondary) => patchBrand({ footerSecondary })}
              placeholder="Referral code: YOURS"
              maxLength={32}
            />
          </Field>
        </div>

        <Field label="Avatar">
          <ImagePicker
            role="avatar"
            selectedId={state.avatarId}
            onSelect={setAvatarId}
            onError={onError}
            emptyLabel="None"
          />
        </Field>
        <Field label="Logo mark" hint="top left">
          <ImagePicker
            role="logo"
            selectedId={state.logoId}
            onSelect={setLogoId}
            onError={onError}
            emptyLabel="None"
          />
        </Field>

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
