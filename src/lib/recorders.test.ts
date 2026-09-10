import { describe, expect, it } from 'vitest';
import { frameSlot, planWebCodecs } from './recorders';

describe('frameSlot', () => {
  it('maps an instant to its 1/fps slot', () => {
    expect(frameSlot(0, 30)).toBe(0);
    expect(frameSlot(33_332, 30)).toBe(0);
    expect(frameSlot(33_334, 30)).toBe(1);
    expect(frameSlot(1_000_000, 30)).toBe(30);
  });

  it('is what keeps the take at one frame a slot, however often the canvas is painted', () => {
    // Paints every 8 ms for a second: 125 paints, 30 distinct slots.
    const slots = new Set<number>();
    for (let t = 0; t < 1_000_000; t += 8_000) slots.add(frameSlot(t, 30));
    expect(slots.size).toBe(30);
  });

  it('lets a slot go by when nothing was painted in it, rather than inventing a frame', () => {
    // A 100 ms gap in paints skips slots 3 and 4 outright.
    const painted = [0, 33_334, 66_667, 166_667, 200_000].map((t) => frameSlot(t, 30));
    expect(painted).toEqual([0, 1, 2, 5, 6]);
  });
});

describe('planWebCodecs', () => {
  it('answers null where WebCodecs does not exist, so the caller falls back', async () => {
    // vitest runs in Node: no VideoEncoder here.
    expect(await planWebCodecs(1680, 1140, 30, 8_000_000, null)).toBeNull();
  });
});
