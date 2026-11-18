import { describe, expect, it } from 'vitest';
import {
  COLUMN_GAP,
  COLUMN_WIDTH,
  MAX_ZOOM,
  MIN_ZOOM,
  PADDING,
  ROW_GAP,
  clampView,
  coverFrame,
  layoutBoard,
  pickTimeframe,
  zoomAt,
  type Category,
  type Frame,
  type Position,
} from './model';

const frame = (w: number, h: number): Frame => ({ thumb: 't', full: 'f', w, h });
const pos = (id: string, frames: Position['frames']): Position => ({ id, categoryId: 'c', frames });

describe('timeframes', () => {
  it('opens on 15M, else the first there is', () => {
    expect(pickTimeframe(pos('a', { '5m': frame(1, 1), '15m': frame(1, 1) }))).toBe('15m');
    expect(pickTimeframe(pos('a', { '1h': frame(1, 1), '5m': frame(1, 1) }))).toBe('5m');
    expect(pickTimeframe(pos('a', {}))).toBeNull();
  });

  it('keeps the asked-for timeframe when the trade has it', () => {
    const p = pos('a', { '5m': frame(1, 1), '15m': frame(1, 1) });
    expect(pickTimeframe(p, '5m')).toBe('5m');
    expect(pickTimeframe(p, '1h')).toBe('15m');
  });

  it('covers the canvas with 15M first', () => {
    const fifteen = frame(2, 1);
    expect(coverFrame(pos('a', { '5m': frame(1, 1), '15m': fifteen }))).toBe(fifteen);
  });
});

describe('layoutBoard', () => {
  const board: Category[] = [
    { id: 'A', name: 'A', positions: [pos('a1', { '15m': frame(1290, 860) }), pos('a2', { '15m': frame(1600, 900) })] },
    { id: 'B', name: 'B', positions: [pos('b1', {}), pos('b2', { '5m': frame(1000, 1000) })] },
  ];
  const layout = layoutBoard(board);

  it('puts columns at fixed, evenly spaced x', () => {
    expect(layout.columns.map((c) => c.x)).toEqual([PADDING, PADDING + COLUMN_WIDTH + COLUMN_GAP]);
  });

  it('keeps each screenshot’s own ratio at the column width', () => {
    const [a1, a2] = layout.items;
    expect(a1!.w).toBe(COLUMN_WIDTH);
    expect(a1!.h).toBe(Math.round((COLUMN_WIDTH * 860) / 1290));
    expect(a2!.y).toBe(a1!.y + a1!.h + ROW_GAP);
    expect(a2!.h).toBe(Math.round((COLUMN_WIDTH * 900) / 1600));
  });

  it('skips positions with no screenshot and numbers by place in the column', () => {
    expect(layout.items.map((i) => i.position.id)).toEqual(['a1', 'a2', 'b2']);
    expect(layout.items[2]!.number).toBe(2);
  });
});

describe('view', () => {
  it('zooms around the pointer', () => {
    const v = zoomAt({ x: 100, y: 50, z: 1 }, 2, 300, 250);
    // The world point under (300, 250) was (200, 200); it still is.
    expect((300 - v.x) / v.z).toBeCloseTo(200);
    expect((250 - v.y) / v.z).toBeCloseTo(200);
  });

  it('clamps zoom', () => {
    expect(zoomAt({ x: 0, y: 0, z: 1 }, 100, 0, 0).z).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, z: 1 }, 0.001, 0, 0).z).toBe(MIN_ZOOM);
  });

  it('never lets the board leave the screen entirely', () => {
    const far = clampView({ x: -1e6, y: 1e6, z: 1 }, 1000, 800, 5000, 4000);
    expect(far.x + 5000).toBeGreaterThan(0);
    expect(far.y).toBeLessThan(800);
  });
});
