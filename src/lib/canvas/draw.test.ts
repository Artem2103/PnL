import { describe, expect, it } from 'vitest';
import type { CardState, RenderAssets } from '../../types';
import { buildContent } from '../content';
import { createDefaultState } from '../defaults';
import { computeCard } from '../pnl';
import { foregroundKey, type DrawInput } from './draw';

/**
 * `renderToCanvas` paints the foreground once and blits the result on every
 * later frame, keyed by `foregroundKey`. Anything the foreground draws that the
 * key does not read would freeze on screen: the card would simply stop
 * responding to that control, silently and only for video backgrounds.
 *
 * So the contract is pinned here from both sides — every input the foreground
 * reads must move the key, and every input it does not read must leave it
 * alone (or a clip would repaint its whole foreground on every scrim nudge).
 */
function inputFor(state: CardState, assets: Partial<RenderAssets> = {}): DrawInput {
  const result = computeCard(state);
  return {
    state,
    content: buildContent(state, result),
    result,
    assets: { artwork: null, avatar: null, logo: null, ...assets },
  };
}

function keyFor(state: CardState, assets: Partial<RenderAssets> = {}): string {
  return foregroundKey(inputFor(state, assets));
}

/** Stand-in for a decoded avatar or logo: the key only reads `.src`. */
function markAt(src: string): HTMLImageElement {
  return { src } as HTMLImageElement;
}

describe('foregroundKey', () => {
  const base = createDefaultState();

  it('is stable for an unchanged card', () => {
    expect(keyFor(createDefaultState())).toBe(keyFor(createDefaultState()));
  });

  const changes: Array<[string, (state: CardState) => CardState]> = [
    ['period title', (s) => ({ ...s, period: { ...s.period, title: 'Q3 2026' } })],
    ['start balance', (s) => ({ ...s, period: { ...s.period, startBalance: 999 } })],
    ['end balance', (s) => ({ ...s, period: { ...s.period, endBalance: 12345 } })],
    ['mode', (s) => ({ ...s, mode: 'trade' })],
    ['symbol', (s) => ({ ...s, mode: 'trade', trade: { ...s.trade, symbol: 'ETHUSDT' } })],
    ['entry price', (s) => ({ ...s, mode: 'trade', trade: { ...s.trade, entryPrice: 42 } })],
    ['exit price', (s) => ({ ...s, mode: 'trade', trade: { ...s.trade, exitPrice: 43 } })],
    ['leverage', (s) => ({ ...s, mode: 'trade', trade: { ...s.trade, leverage: 5 } })],
    ['pnl sign', (s) => ({ ...s, mode: 'trade', trade: { ...s.trade, pnl: -100 } })],
    ['wordmark', (s) => ({ ...s, brand: { ...s.brand, wordmark: 'OTHER' } })],
    ['handle', (s) => ({ ...s, brand: { ...s.brand, handle: '@someone' } })],
    ['footer left', (s) => ({ ...s, brand: { ...s.brand, footerPrimary: 'elsewhere.com' } })],
    ['footer right', (s) => ({ ...s, brand: { ...s.brand, footerSecondary: 'Code: OTHER' } })],
    ['currency', (s) => ({ ...s, brand: { ...s.brand, currency: 'EUR' } })],
    ['theme', (s) => ({ ...s, display: { ...s.display, themeId: 'gold' } })],
    ['text tone', (s) => ({ ...s, display: { ...s.display, textTone: 'dark' } })],
    [
      'custom accent',
      (s) => ({ ...s, display: { ...s.display, themeId: 'custom', customAccent: '#00FF88' } }),
    ],
    ['compact hero', (s) => ({ ...s, display: { ...s.display, compactHero: false } })],
    ['show rows', (s) => ({ ...s, display: { ...s.display, showRows: false } })],
    ['show handle', (s) => ({ ...s, display: { ...s.display, showHandle: false } })],
    ['show footer', (s) => ({ ...s, display: { ...s.display, showFooter: false } })],
    ['show wordmark', (s) => ({ ...s, display: { ...s.display, showWordmark: false } })],
    ['show logo', (s) => ({ ...s, display: { ...s.display, showLogo: false } })],
  ];

  for (const [label, mutate] of changes) {
    it(`changes when the ${label} changes`, () => {
      expect(keyFor(mutate(base))).not.toBe(keyFor(base));
    });
  }

  /**
   * The custom accent is the one field that changes the card without changing
   * `themeId`, so a key that read the id alone would freeze a clip's whole
   * foreground on whatever colour was picked first.
   */
  it('changes when only the custom colour moves', () => {
    const custom = (accent: string): CardState => ({
      ...base,
      display: { ...base.display, themeId: 'custom', customAccent: accent },
    });
    expect(keyFor(custom('#00FF88'))).not.toBe(keyFor(custom('#FF0088')));
  });

  it('changes when the avatar changes', () => {
    expect(keyFor(base, { avatar: markAt('blob:a') })).not.toBe(
      keyFor(base, { avatar: markAt('blob:b') }),
    );
    expect(keyFor(base, { avatar: markAt('blob:a') })).not.toBe(keyFor(base));
  });

  it('changes when the logo changes', () => {
    expect(keyFor(base, { logo: markAt('blob:a') })).not.toBe(
      keyFor(base, { logo: markAt('blob:b') }),
    );
  });

  const background: Array<[string, (state: CardState) => CardState]> = [
    ['scrim', (s) => ({ ...s, artwork: { ...s.artwork, scrim: 0.2 } })],
    ['zoom', (s) => ({ ...s, artwork: { ...s.artwork, zoom: 2.4 } })],
    ['horizontal pan', (s) => ({ ...s, artwork: { ...s.artwork, offsetX: -0.7 } })],
    ['vertical pan', (s) => ({ ...s, artwork: { ...s.artwork, offsetY: 0.7 } })],
    ['chosen background', (s) => ({ ...s, artwork: { ...s.artwork, imageId: 'other' } })],
    ['clip start', (s) => ({ ...s, artwork: { ...s.artwork, clipStart: 4 } })],
    ['clip length', (s) => ({ ...s, artwork: { ...s.artwork, clipLength: 6 } })],
  ];

  for (const [label, mutate] of background) {
    it(`is unaffected by the ${label}, which only the background reads`, () => {
      expect(keyFor(mutate(base))).toBe(keyFor(base));
    });
  }
});
