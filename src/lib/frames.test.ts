import { describe, expect, it } from 'vitest';
import { AVATAR_FRAME } from './canvas/spec';
import { hexToRgb } from './color';
import { DEFAULT_FRAME_COLOR, DEFAULT_FRAME_ID, FRAMES, badgePalette, frameById } from './frames';

const channels = (hex: string): number[] => {
  const rgb = hexToRgb(hex)!;
  return [rgb.r, rgb.g, rgb.b];
};

const maxChannelError = (a: string, b: string): number =>
  Math.max(...channels(a).map((v, i) => Math.abs(v - channels(b)[i]!)));

describe('FRAMES', () => {
  it('has unique ids and exactly one colourable frame', () => {
    const ids = FRAMES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(FRAMES.filter((f) => f.colourable).map((f) => f.id)).toEqual(['pin']);
  });

  it('falls back to the default frame for an id it does not know', () => {
    expect(frameById('not-a-frame').id).toBe(DEFAULT_FRAME_ID);
    expect(frameById('tag').id).toBe('tag');
  });
});

describe('badgePalette', () => {
  /**
   * The whole point of deriving the palette: with the reference's own red in,
   * the measured badge has to come back out. One number per stop cannot hit
   * every channel exactly — the measured ramp is not a perfect mix toward
   * black or white — so the bound is a few levels, not zero.
   */
  it('reproduces the measured badge from the reference red', () => {
    const palette = badgePalette(DEFAULT_FRAME_COLOR);
    expect(palette.ringStops.length).toBe(AVATAR_FRAME.ringStops.length);
    let worst = 0;
    palette.ringStops.forEach((stop, i) => {
      const measured = AVATAR_FRAME.ringStops[i]!;
      expect(stop.offset).toBe(measured.offset);
      worst = Math.max(worst, maxChannelError(stop.color, measured.color));
    });
    palette.pipFillStops.forEach((stop, i) => {
      worst = Math.max(worst, maxChannelError(stop.color, AVATAR_FRAME.pipFillStops[i]!.color));
    });
    worst = Math.max(worst, maxChannelError(palette.pipLight, AVATAR_FRAME.pipLight));
    expect(worst).toBeLessThanOrEqual(14);
  });

  it('keeps the base colour in the vivid stops and only shades it elsewhere', () => {
    const palette = badgePalette('#1E90FF');
    // The flat half of the pip's base is the base colour itself.
    expect(palette.pipFillStops[0]!.color).toBe('#1E90FF');
    // Every ring stop is blue-dominant: shading never changes the hue.
    for (const stop of palette.ringStops) {
      const [r, g, b] = channels(stop.color) as [number, number, number];
      expect(b).toBeGreaterThanOrEqual(g);
      expect(b).toBeGreaterThanOrEqual(r);
    }
    // The tip is a lighter version of the base, not a different colour.
    const tip = channels(palette.pipLight);
    expect(tip[2]).toBeGreaterThan(channels('#1E90FF')[2]! - 1);
    expect(tip[0]).toBeGreaterThan(channels('#1E90FF')[0]!);
  });

  it('shades a light base toward black rather than washing it out', () => {
    const palette = badgePalette('#FFD700');
    const darkest = palette.ringStops.reduce((a, b) =>
      channels(a.color).reduce((s, v) => s + v, 0) < channels(b.color).reduce((s, v) => s + v, 0) ? a : b,
    );
    expect(channels(darkest.color)[0]).toBeLessThan(200);
  });

  it('falls back to the reference red for an unparseable colour', () => {
    expect(badgePalette('not a colour').pipLight).toBe(badgePalette(DEFAULT_FRAME_COLOR).pipLight);
  });
});
