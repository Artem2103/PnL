import { describe, expect, it } from 'vitest';
import { panBy, placeCover } from './placement';

const CARD_W = 840;
const CARD_H = 570;

describe('placeCover', () => {
  it('covers the card with no gaps for a wide source', () => {
    const p = placeCover(1920, 1080, CARD_W, CARD_H);
    expect(p.h).toBeCloseTo(CARD_H, 6);
    expect(p.w).toBeGreaterThanOrEqual(CARD_W);
    expect(p.x).toBeLessThanOrEqual(0);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('covers the card with no gaps for a tall source', () => {
    const p = placeCover(1080, 1920, CARD_W, CARD_H);
    expect(p.w).toBeCloseTo(CARD_W, 6);
    expect(p.h).toBeGreaterThan(CARD_H);
    expect(p.overflowX).toBe(0);
    expect(p.overflowY).toBeGreaterThan(0);
  });

  it('leaves no overflow when the source matches the card ratio', () => {
    const p = placeCover(CARD_W * 3, CARD_H * 3, CARD_W, CARD_H);
    expect(p.overflowX).toBeCloseTo(0, 6);
    expect(p.overflowY).toBeCloseTo(0, 6);
  });

  it('pans to either edge at ±1 without ever uncovering the card', () => {
    // +1 slides the photo right, so its left edge lands on the card's.
    const pushedRight = placeCover(1920, 1080, CARD_W, CARD_H, 1, 1, 0);
    expect(pushedRight.x).toBeCloseTo(0, 6);
    expect(pushedRight.x + pushedRight.w).toBeGreaterThanOrEqual(CARD_W);

    const pushedLeft = placeCover(1920, 1080, CARD_W, CARD_H, 1, -1, 0);
    expect(pushedLeft.x).toBeLessThanOrEqual(0);
    expect(pushedLeft.x + pushedLeft.w).toBeCloseTo(CARD_W, 6);
  });

  it('pans vertically only when zoom creates vertical slack', () => {
    // A 16:9 source is already exactly as tall as the card, so there is
    // nothing to pan into and the vertical offset is inert.
    const flat = placeCover(1920, 1080, CARD_W, CARD_H, 1, 0, -1);
    expect(flat.y).toBeCloseTo(0, 6);

    const zoomed = placeCover(1920, 1080, CARD_W, CARD_H, 1.5, 0, -1);
    expect(zoomed.overflowY).toBeGreaterThan(0);
    expect(zoomed.y).toBeLessThan(0);
    expect(zoomed.y + zoomed.h).toBeCloseTo(CARD_H, 6);
  });

  it('clamps pan beyond the edges', () => {
    const far = placeCover(1920, 1080, CARD_W, CARD_H, 1, 7, 0);
    const edge = placeCover(1920, 1080, CARD_W, CARD_H, 1, 1, 0);
    expect(far.x).toBeCloseTo(edge.x, 6);
  });

  it('keeps the card covered at every pan value', () => {
    for (const zoom of [1, 1.4, 2, 3]) {
      for (let offset = -1; offset <= 1.0001; offset += 0.25) {
        const p = placeCover(1600, 900, CARD_W, CARD_H, zoom, offset, offset);
        expect(p.x).toBeLessThanOrEqual(1e-6);
        expect(p.y).toBeLessThanOrEqual(1e-6);
        expect(p.x + p.w).toBeGreaterThanOrEqual(CARD_W - 1e-6);
        expect(p.y + p.h).toBeGreaterThanOrEqual(CARD_H - 1e-6);
      }
    }
  });

  it('falls back to 1× for a nonsense zoom', () => {
    expect(placeCover(1920, 1080, CARD_W, CARD_H, Number.NaN).w).toBeCloseTo(
      placeCover(1920, 1080, CARD_W, CARD_H, 1).w,
      6,
    );
  });
});

describe('panBy', () => {
  it('moves the photo by exactly the dragged distance', () => {
    // 200px of slack, dragged 50px right -> a quarter of the way.
    expect(panBy(0, 50, 200)).toBeCloseTo(0.25, 6);
  });

  it('is a no-op when there is no slack to pan into', () => {
    expect(panBy(0.4, 120, 0)).toBe(0.4);
  });

  it('stops at the edge', () => {
    expect(panBy(0.9, 400, 200)).toBe(1);
    expect(panBy(-0.9, -400, 200)).toBe(-1);
  });

  it('round-trips a drag and its reverse', () => {
    const there = panBy(0, 60, 300);
    expect(panBy(there, -60, 300)).toBeCloseTo(0, 6);
  });
});
