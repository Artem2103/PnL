export type Direction = 'long' | 'short';

/**
 * Which set of numbers the card is built from. Both render through the exact
 * same layout — only the three row labels and the title differ.
 */
export type CardMode =
  /** A single trade: symbol, entry, exit, leverage. */
  | 'trade'
  /** A period summary: month, start balance, end balance. */
  | 'period';

export interface TradeState {
  symbol: string;
  direction: Direction;
  leverage: number;
  entryPrice: number;
  exitPrice: number;
  /**
   * Profit or loss in the quote currency, entered directly.
   *
   * Position size is deliberately not an input: it varies by platform (MT5
   * lots, contracts, base units) and only scales the money — the percentage is
   * a function of the prices and leverage alone.
   */
  pnl: number;
  /** Show "Long 20×" after the symbol in the title. */
  showDirectionInTitle: boolean;
}

export interface PeriodState {
  /** Free text so "August 2026", "Q3 2026" or "Week 34" all work. */
  title: string;
  startBalance: number;
  endBalance: number;
}

export interface BrandState {
  /** Top-right wordmark. Empty hides it. */
  wordmark: string;
  handle: string;
  footerPrimary: string;
  footerSecondary: string;
  currency: string;
}

/**
 * Which of the two inks every string outside the accent block is printed in.
 * `light` is the reference card; `dark` turns the whole card over — the plain
 * ground and the artwork scrim follow it, or black text would be painted on a
 * near-black ground and simply not be there.
 */
export type TextTone = 'light' | 'dark';

export interface DisplayState {
  /** A preset id from `THEMES`, or `'custom'` to use `customAccent`. */
  themeId: string;
  /** The colour behind `themeId === 'custom'`. Any `#rrggbb`. */
  customAccent: string;
  textTone: TextTone;
  /** Accent-coloured percentage on the first row. */
  showRows: boolean;
  showHandle: boolean;
  showFooter: boolean;
  showWordmark: boolean;
  showLogo: boolean;
  /** Compact "+$10.1K" instead of "+$10,148.00". */
  compactHero: boolean;
}

export interface ArtworkState {
  /** Media library id (photo or clip), or null for the plain themed background. */
  imageId: string | null;
  /** Strength of the dark scrim over the text column, 0..1. */
  scrim: number;
  /** 1..3 zoom on top of the cover fit. */
  zoom: number;
  /** Horizontal pan, -1..1, so the subject can be pushed clear of the text. */
  offsetX: number;
  /** Vertical pan, -1..1. Only bites when the fit leaves vertical overflow. */
  offsetY: number;
  /** Video only: seconds into the clip where the card starts. */
  clipStart: number;
  /** Video only: seconds of clip used, capped at MAX_CLIP_SECONDS. */
  clipLength: number;
  /** Video only: drop the clip's own audio from the exported file. */
  muteAudio: boolean;
}

export interface CardState {
  mode: CardMode;
  trade: TradeState;
  period: PeriodState;
  brand: BrandState;
  display: DisplayState;
  artwork: ArtworkState;
  /** Image library id for the avatar beside the handle. */
  avatarId: string | null;
  /** Image library id for the top-left logo mark. */
  logoId: string | null;
}

/**
 * A decoded background, either a still or a clip. The renderer only ever asks
 * it for pixels and its intrinsic size, so both kinds paint through the same
 * code path.
 */
export interface BackgroundMedia {
  kind: 'image' | 'video';
  element: HTMLImageElement | HTMLVideoElement;
  width: number;
  height: number;
  /** Seconds. Zero for stills. */
  duration: number;
}

/** Everything the renderer needs that had to be resolved asynchronously. */
export interface RenderAssets {
  artwork: BackgroundMedia | null;
  avatar: HTMLImageElement | null;
  logo: HTMLImageElement | null;
}
