import { describe, expect, it } from 'vitest';
import type { CardState, StudioClip } from '../../types';
import { createDefaultState, hydrateState } from '../defaults';
import { buildContent } from '../content';
import { computeCard, computeTrade } from '../pnl';
import { foregroundKey } from '../canvas/draw';
import { CARD } from '../canvas/spec';
import { cardRect, clipAt, EXPORT_SIZE, timeline } from './frame';

const clip = (id: string, start: number, length: number): StudioClip => ({
  id,
  mediaId: id,
  start,
  length,
  volume: 1,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
});

describe('the studio frame', () => {
  const studio = createDefaultState().studio;

  it('fits the card whole and centred, and never moves it', () => {
    const { width, height } = EXPORT_SIZE['16:9'];
    const rect = cardRect({ ...studio, aspect: '16:9' }, width, height);
    // 840×570 is taller than 16:9, so the height decides.
    expect(rect.h).toBeCloseTo(height);
    expect(rect.w).toBeCloseTo((height * CARD.width) / CARD.height);
    expect(rect.x).toBeCloseTo((width - rect.w) / 2);
    expect(rect.y).toBeCloseTo(0);
  });

  it('runs the card the full width of a square frame', () => {
    const rect = cardRect({ ...studio, aspect: '1:1' }, 1080, 1080);
    expect(rect.w).toBeCloseTo(1080);
    expect(rect.y).toBeCloseTo((1080 - rect.h) / 2);
  });

  it('is the whole picture for the card-shaped video', () => {
    expect(cardRect({ ...studio, aspect: 'card' }, 1680, 1140)).toEqual({ x: 0, y: 0, w: 1680, h: 1140 });
  });

  it('exports even sizes, as H.264 wants', () => {
    for (const { width, height } of Object.values(EXPORT_SIZE)) {
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
    }
  });

  it('lays clips end to end and finds the one playing', () => {
    const clips = [clip('a', 5, 3), clip('b', 0, 2)];
    expect(timeline(clips)).toEqual({ starts: [0, 3], total: 5 });
    expect(clipAt(clips, 1)).toMatchObject({ index: 0, fileTime: 6 });
    expect(clipAt(clips, 4)).toMatchObject({ index: 1, fileTime: 1 });
    expect(clipAt([], 1)).toBeNull();
  });
});

describe('saved studios', () => {
  it('fill in what an older save lacks', () => {
    const state = hydrateState({ mode: 'period' });
    expect(state.studio).toEqual({ aspect: '16:9', clips: [], tracks: [] });
    expect(state.display.showBlock).toBe(true);
    expect(state.display.textColor).toBeNull();
  });

  it('keep at most ten sounds and clamp what is out of range', () => {
    const tracks = Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, soundId: `s${i}`, name: 'x', at: -4, start: 0, length: 3, volume: 7 }));
    const state = hydrateState({ studio: { aspect: '9:16', clips: [{ mediaId: 'm', zoom: 9 }], tracks } });
    expect(state.studio.aspect).toBe('16:9');
    expect(state.studio.tracks).toHaveLength(10);
    expect(state.studio.tracks[0]).toMatchObject({ at: 0, volume: 1 });
    expect(state.studio.clips[0]).toMatchObject({ mediaId: 'm', zoom: 3, volume: 1 });
  });
});

describe('the Customize options', () => {
  const keyOf = (state: CardState) => {
    const result = computeCard(state);
    return foregroundKey({ state, content: buildContent(state, result), result, assets: { artwork: null, avatar: null, logo: null } });
  };
  const base = createDefaultState();

  it.each([
    ['text colour', { textColor: '#FFD84D' }],
    ['profit colour', { profitColor: '#00FF00' }],
    ['loss colour', { lossColor: '#FF0000' }],
    ['block text colour', { blockTextColor: '#FFFFFF' }],
    ['bold', { boldText: true }],
    ['shadow', { textShadow: true }],
    ['no block', { showBlock: false }],
    ['token image', { showTokenImage: true }],
  ])('repaints the card for %s', (_, patch) => {
    expect(keyOf({ ...base, display: { ...base.display, ...patch } })).not.toBe(keyOf(base));
  });

  it("leaves the editor's own percentage alone when no journal figure is given", () => {
    const trade = { ...base.trade, direction: 'long' as const, entryPrice: 100, exitPrice: 110, leverage: 2 };
    expect(computeTrade(trade).roiPct).toBeCloseTo(20);
    expect(computeTrade({ ...trade, pnlPct: 1.5 }).roiPct).toBe(1.5);
  });
});
