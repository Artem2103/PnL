/**
 * Boards: the community's library of trading positions, laid out on one canvas.
 *
 * A position is one trade. It carries up to three screenshots of that trade, one
 * per timeframe; the canvas shows one of them and the viewer switches between
 * them. Everything here is plain data and arithmetic so it can be tested
 * without a browser.
 */

export const TIMEFRAMES = ['5m', '15m', '1h'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const DEFAULT_TIMEFRAME: Timeframe = '15m';
export const TIMEFRAME_LABEL: Record<Timeframe, string> = { '5m': '5M', '15m': '15M', '1h': '1H' };

export interface Frame {
  /** Small copy for the canvas. */
  readonly thumb: string;
  /** The original screenshot, untouched, for the viewer. */
  readonly full: string;
  /** Pixel size of the original. Only the ratio is used on screen. */
  readonly w: number;
  readonly h: number;
}

export interface Position {
  id: string;
  categoryId: string;
  frames: Partial<Record<Timeframe, Frame>>;
  /** Where the trade was posted (a Telegram message). Shown in the viewer only. */
  link?: string | null;
}

export interface Category {
  id: string;
  name: string;
  positions: Position[];
}

/** The screenshot the canvas shows for a position: 15M, else the first there is. */
export function coverFrame(position: Position): Frame | null {
  return position.frames[DEFAULT_TIMEFRAME] ?? TIMEFRAMES.map((tf) => position.frames[tf]).find(Boolean) ?? null;
}

/** Which timeframe to open on: the one asked for if it exists, then 15M, then any. */
export function pickTimeframe(position: Position, wanted: Timeframe = DEFAULT_TIMEFRAME): Timeframe | null {
  if (position.frames[wanted]) return wanted;
  if (position.frames[DEFAULT_TIMEFRAME]) return DEFAULT_TIMEFRAME;
  return TIMEFRAMES.find((tf) => position.frames[tf]) ?? null;
}

/* ------------------------------------------------------------------ layout */

export const COLUMN_WIDTH = 380;
/** Between columns: generous, so each column reads as its own category. */
export const COLUMN_GAP = 156;
/** Between positions in a column: tight, so a column reads as one list. */
export const ROW_GAP = 18;
/** Room above the first position for the column's letter. */
export const HEADER_HEIGHT = 64;
/** Empty canvas around the content on every side. */
export const PADDING = 72;

export interface PlacedPosition {
  position: Position;
  category: Category;
  /** 1-based, within its column. */
  number: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  columns: { category: Category; x: number }[];
  items: PlacedPosition[];
  width: number;
  height: number;
}

export function layoutBoard(categories: Category[]): Layout {
  const columns: Layout['columns'] = [];
  const items: PlacedPosition[] = [];
  let bottom = PADDING + HEADER_HEIGHT;

  categories.forEach((category, index) => {
    const x = PADDING + index * (COLUMN_WIDTH + COLUMN_GAP);
    columns.push({ category, x });
    let y = PADDING + HEADER_HEIGHT;
    category.positions.forEach((position, row) => {
      const frame = coverFrame(position);
      if (!frame) return;
      const h = Math.round((COLUMN_WIDTH * frame.h) / frame.w);
      items.push({ position, category, number: row + 1, x, y, w: COLUMN_WIDTH, h });
      y += h + ROW_GAP;
    });
    bottom = Math.max(bottom, y - ROW_GAP);
  });

  const width = categories.length
    ? PADDING * 2 + categories.length * COLUMN_WIDTH + (categories.length - 1) * COLUMN_GAP
    : PADDING * 2;
  return { columns, items, width, height: bottom + PADDING };
}

/* -------------------------------------------------------------------- view */

/** Screen = world × z + (x, y). */
export interface View {
  x: number;
  y: number;
  z: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.5;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Zooms to `z` keeping the world point under screen point (sx, sy) where it is. */
export function zoomAt(view: View, z: number, sx: number, sy: number): View {
  const next = clampZoom(z);
  const k = next / view.z;
  return { x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k, z: next };
}

/**
 * Keeps some of the board on screen whatever happens: the content may move off
 * an edge by at most `slack` of the viewport, so nobody pans into nowhere.
 */
export function clampView(view: View, vw: number, vh: number, width: number, height: number, slack = 0.5): View {
  const axis = (pos: number, viewport: number, size: number) => {
    const extent = size * view.z;
    const margin = viewport * slack;
    const min = Math.min(viewport - extent - margin, (viewport - extent) / 2);
    const max = Math.max(margin, (viewport - extent) / 2);
    return Math.min(max, Math.max(min, pos));
  };
  return { x: axis(view.x, vw, width), y: axis(view.y, vh, height), z: view.z };
}

/** Where a visit starts: top-left of the board, at a zoom that fits a column on a phone. */
export function initialView(vw: number): View {
  const z = clampZoom(Math.min(1, (vw - 32) / (COLUMN_WIDTH + PADDING)));
  return { x: vw < 600 ? 16 - PADDING * z : 0, y: 0, z };
}
