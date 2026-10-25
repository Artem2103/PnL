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
  /**
   * The PNL row's percentage, given directly. The editor never sets it; the
   * journal does, with the trade's PnL as a % of the balance at entry, which
   * prices and leverage cannot reproduce for a lot-sized position.
   */
  pnlPct?: number | null;
  /** The instrument's logo, for `showTokenImage`. Set by the journal from /logos. */
  logoUrl?: string | null;
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
  currency: string;
}

/*
 * The footer's right-hand string is deliberately *not* here. It is fixed, and
 * a state field that must never vary is a lie the next reader has to check:
 * see `FOOTER_SECONDARY` in `lib/content.ts`.
 */

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
  /** Which frame the avatar sits in: an id from `FRAMES`. */
  frameId: string;
  /**
   * The base colour of the one frame that takes one (the pin badge). Kept
   * even while another frame is chosen, so switching back does not lose it.
   */
  frameColor: string;
  /*
   * The "Customize" options. Each colour is null while it follows the theme,
   * so a card that never touched them looks exactly as it always did.
   */
  /** Every string outside the block. */
  textColor: string | null;
  /** The block and the percentage when the result is up. */
  profitColor: string | null;
  /** The same when it is down. */
  lossColor: string | null;
  /** The value inside the block; null picks black or white for contrast. */
  blockTextColor: string | null;
  /** Heavier weights for the title, rows, handle and footer. */
  boldText: boolean;
  /** A soft shadow under every string, for busy backgrounds. */
  textShadow: boolean;
  /** The coloured rectangle behind the big value. Off prints the value in colour instead. */
  showBlock: boolean;
  /** The instrument's logo before the title, on a trade card. */
  showTokenImage: boolean;
}

export interface ArtworkState {
  /** Media library id (photo or clip), or null for the plain themed background. */
  imageId: string | null;
  /**
   * A built-in background from `canvas/scenes.ts`, or null for none. It and
   * `imageId` are alternatives — the editor clears one when the other is
   * picked — and an upload wins if both are somehow set.
   */
  sceneId: string | null;
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

/** The frame a composed video is exported in. `card` is the card itself, clip behind it. */
export type StudioAspect = 'card' | '16:9' | '4:3' | '1:1';

/** One clip on the video timeline. Clips play one after another. */
export interface StudioClip {
  /** This placement's own id: the same file can be on the timeline twice. */
  id: string;
  /** Media library id of the clip. */
  mediaId: string;
  /** Seconds into the file. */
  start: number;
  /** Seconds used. */
  length: number;
  /** 0..1. */
  volume: number;
  /** Placement of the clip in the frame, as for the card's background. */
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/** A sound laid under the timeline: music, a voice-over. */
export interface StudioTrack {
  id: string;
  /** Id in the browser's sound store (`lib/studio/sounds.ts`). */
  soundId: string;
  name: string;
  /** Where it starts on the timeline, seconds. */
  at: number;
  /** Seconds into the file. */
  start: number;
  /** Seconds used. */
  length: number;
  volume: number;
}

export interface StudioState {
  /** The size of the exported video. The card sits fixed in it; only the clip moves. */
  aspect: StudioAspect;
  /** The clip behind the card: one, as the share sheet makes it. */
  clips: StudioClip[];
  tracks: StudioTrack[];
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
  /** The video studio: frame, timeline and sounds. */
  studio: StudioState;
}

/**
 * A decoded background, either a still or a clip. The renderer only ever asks
 * it for pixels and its intrinsic size, so both kinds paint through the same
 * code path.
 */
export interface BackgroundMedia {
  kind: 'image' | 'video';
  /**
   * What `drawImage` is handed. The preview and the live recorder draw a
   * `<video>`; the frame-exact exporter draws each decoded `VideoFrame`, or a
   * canvas holding it turned the right way up.
   */
  element: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | VideoFrame;
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
  /** The instrument's logo, when the card shows one. */
  token?: HTMLImageElement | null;
}
