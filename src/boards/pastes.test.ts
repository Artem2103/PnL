import { describe, expect, it } from 'vitest';
import { PASTE_MIN, placePaste, resizePaste } from './pastes';

describe('placePaste', () => {
  it('keeps a small image at its own pixel size on screen, centred on the point', () => {
    expect(placePaste(200, 100, { x: 500, y: 500 }, 1)).toEqual({ x: 400, y: 450, w: 200, h: 100 });
  });

  it('shrinks a big image to 520 px on its long side', () => {
    const p = placePaste(2080, 1040, { x: 0, y: 0 }, 1);
    expect(p.w).toBe(520);
    expect(p.h).toBe(260);
  });

  it('is the same size on screen at any zoom', () => {
    const p = placePaste(2080, 1040, { x: 0, y: 0 }, 0.5);
    expect(p.w * 0.5).toBe(520);
  });
});

describe('resizePaste', () => {
  it('keeps the proportions', () => {
    expect(resizePaste(200, 100, 100, 0)).toEqual({ w: 300, h: 150 });
    expect(resizePaste(200, 100, 0, 100)).toEqual({ w: 400, h: 200 });
  });

  it('never goes below the minimum', () => {
    expect(resizePaste(200, 100, -500, 0).w).toBe(PASTE_MIN);
  });
});
