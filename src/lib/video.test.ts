import { describe, expect, it } from 'vitest';
import {
  MAX_VIDEO_SCALE,
  MIN_VIDEO_SCALE,
  pickMimeType,
  resolveClip,
  videoFileName,
  videoScaleFor,
} from './video';
import { MAX_CLIP_SECONDS } from './images';
import { createDefaultState } from './defaults';

describe('pickMimeType', () => {
  it('prefers MP4 when the browser can record it', () => {
    const picked = pickMimeType(() => true);
    expect(picked?.extension).toBe('mp4');
  });

  it('falls back to WebM when MP4 is unavailable', () => {
    const picked = pickMimeType((type) => type.startsWith('video/webm'));
    expect(picked?.extension).toBe('webm');
    expect(picked?.mimeType).toContain('vp9');
  });

  it('reports nothing when no candidate is supported', () => {
    expect(pickMimeType(() => false)).toBeNull();
  });
});

describe('resolveClip', () => {
  it('uses the whole clip when it is shorter than the cap', () => {
    expect(resolveClip(8, 0, MAX_CLIP_SECONDS)).toEqual({ start: 0, length: 8 });
  });

  it('never exceeds the 15 second cap', () => {
    expect(resolveClip(90, 0, 60).length).toBe(MAX_CLIP_SECONDS);
  });

  it('shortens the window when the start point leaves less clip than asked for', () => {
    expect(resolveClip(20, 18, 10)).toEqual({ start: 18, length: 2 });
  });

  it('keeps the start point inside the clip', () => {
    const { start } = resolveClip(10, 40, 5);
    expect(start).toBeLessThan(10);
    expect(start).toBeGreaterThanOrEqual(0);
  });

  it('rejects a start point before zero', () => {
    expect(resolveClip(10, -4, 5)).toEqual({ start: 0, length: 5 });
  });

  it('returns an empty window for an unusable duration', () => {
    expect(resolveClip(0, 0, 5)).toEqual({ start: 0, length: 0 });
    expect(resolveClip(Number.NaN, 0, 5)).toEqual({ start: 0, length: 0 });
    expect(resolveClip(Number.POSITIVE_INFINITY, 0, 5)).toEqual({ start: 0, length: 0 });
  });

  it('treats a missing length as the full cap', () => {
    expect(resolveClip(30, 0, 0).length).toBe(MAX_CLIP_SECONDS);
  });
});

describe('videoFileName', () => {
  it('names the file after the period title', () => {
    const state = createDefaultState();
    expect(videoFileName(state, 'mp4')).toBe('august-2026-pnl.mp4');
  });

  it('names the file after the symbol in trade mode', () => {
    const state = { ...createDefaultState(), mode: 'trade' as const };
    expect(videoFileName(state, 'webm')).toBe('btcusdt-pnl.webm');
  });
});

describe('videoScaleFor', () => {
  /**
   * A PNG at 1x is a fine 840x570 image; a video at 1x is not, because every
   * platform re-encodes it and a card that small arrives with its numbers
   * smeared. The scale chips are shared with the PNG export, so the floor has
   * to be applied here rather than by hiding the 1x chip.
   */
  it('never records below 2x, whatever the PNG scale is set to', () => {
    expect(videoScaleFor(1)).toBe(2);
    expect(videoScaleFor(0.5)).toBe(2);
    expect(videoScaleFor(-3)).toBe(2);
  });

  it('never records above 2x, because encoding cost outruns the extra pixels', () => {
    expect(videoScaleFor(3)).toBe(2);
    expect(videoScaleFor(64)).toBe(2);
  });

  it('falls back to the floor for a nonsense scale', () => {
    expect(videoScaleFor(Number.NaN)).toBe(MIN_VIDEO_SCALE);
    expect(videoScaleFor(Number.POSITIVE_INFINITY)).toBe(MIN_VIDEO_SCALE);
  });

  it('always lands inside the supported range', () => {
    for (const scale of [0, 0.25, 1, 1.5, 2, 2.5, 3, 10]) {
      const resolved = videoScaleFor(scale);
      expect(resolved).toBeGreaterThanOrEqual(MIN_VIDEO_SCALE);
      expect(resolved).toBeLessThanOrEqual(MAX_VIDEO_SCALE);
    }
  });
});
