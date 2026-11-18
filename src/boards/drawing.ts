/**
 * Freehand drawing on the board. Strokes live in board coordinates, so they pan
 * and zoom with the screenshots; their width is in screen pixels (1–4 px at any
 * zoom, as in TradingView).
 *
 * Drawings belong to this browser only: they are kept in localStorage and never
 * reach the database or other viewers.
 */

export interface Stroke {
  id: string;
  color: string;
  /** Screen pixels, 1–4. */
  width: number;
  /** Flat board coordinates: x0, y0, x1, y1, … */
  points: number[];
}

export interface InkTool {
  color: string;
  width: number;
}

export const INK_COLORS = ['#f23645', '#ff9800', '#f7c600', '#089981', '#2962ff', '#9c27b0', '#131722', '#ffffff'] as const;
export const INK_WIDTHS = [1, 2, 3, 4] as const;
export const DEFAULT_TOOL: InkTool = { color: '#2962ff', width: 2 };

const STROKES_KEY = 'astra.boards.drawings.v1';
const TOOL_KEY = 'astra.boards.ink.v1';
const HEX = /^#[0-9a-f]{6}$/i;

const round = (n: number) => Math.round(n * 10) / 10;

/** A smooth SVG path through the points (quadratic curves through the midpoints). */
export function strokePath(points: number[]): string {
  const n = points.length >> 1;
  if (n === 0) return '';
  const px = (i: number) => points[i * 2] ?? 0;
  const py = (i: number) => points[i * 2 + 1] ?? 0;
  const x = (i: number) => round(px(i));
  const y = (i: number) => round(py(i));
  // A single press is a dot: a zero-length line with round caps.
  if (n === 1) return `M${x(0)} ${y(0)}l0.01 0`;
  if (n === 2) return `M${x(0)} ${y(0)}L${x(1)} ${y(1)}`;
  let d = `M${x(0)} ${y(0)}`;
  for (let i = 1; i < n - 1; i++) {
    d += `Q${x(i)} ${y(i)} ${round((px(i) + px(i + 1)) / 2)} ${round((py(i) + py(i + 1)) / 2)}`;
  }
  return `${d}L${x(n - 1)} ${y(n - 1)}`;
}

export const isInkColor = (value: unknown): value is string => typeof value === 'string' && HEX.test(value);
export const isInkWidth = (value: unknown): value is number => (INK_WIDTHS as readonly unknown[]).includes(value);

function isStroke(value: unknown): value is Stroke {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Stroke>;
  return (
    typeof s.id === 'string' &&
    isInkColor(s.color) &&
    isInkWidth(s.width) &&
    Array.isArray(s.points) &&
    s.points.length >= 2 &&
    s.points.length % 2 === 0 &&
    s.points.every((p) => typeof p === 'number' && Number.isFinite(p))
  );
}

export function parseStrokes(raw: string | null): Stroke[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isStroke) : [];
  } catch {
    return [];
  }
}

export function loadStrokes(): Stroke[] {
  try {
    return parseStrokes(localStorage.getItem(STROKES_KEY));
  } catch {
    return [];
  }
}

export function saveStrokes(strokes: Stroke[]) {
  try {
    if (strokes.length === 0) localStorage.removeItem(STROKES_KEY);
    else localStorage.setItem(STROKES_KEY, JSON.stringify(strokes));
  } catch {
    // Storage full or blocked: the drawing still shows until the page closes.
  }
}

export function loadTool(): InkTool {
  try {
    const value = JSON.parse(localStorage.getItem(TOOL_KEY) ?? 'null') as Partial<InkTool> | null;
    return {
      color: isInkColor(value?.color) ? value.color : DEFAULT_TOOL.color,
      width: isInkWidth(value?.width) ? value.width : DEFAULT_TOOL.width,
    };
  } catch {
    return DEFAULT_TOOL;
  }
}

export function saveTool(tool: InkTool) {
  try {
    localStorage.setItem(TOOL_KEY, JSON.stringify(tool));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

let counter = 0;
export const strokeId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;
