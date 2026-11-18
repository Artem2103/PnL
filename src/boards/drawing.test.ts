import { describe, expect, it } from 'vitest';
import { parseStrokes, strokePath } from './drawing';

describe('strokePath', () => {
  it('draws a dot for a single press', () => {
    expect(strokePath([10, 20])).toBe('M10 20l0.01 0');
  });

  it('draws a straight line for two points', () => {
    expect(strokePath([0, 0, 5.04, 6])).toBe('M0 0L5 6');
  });

  it('curves through the midpoints and ends on the last point', () => {
    expect(strokePath([0, 0, 10, 0, 10, 10])).toBe('M0 0Q10 0 10 5L10 10');
  });

  it('is empty for no points', () => {
    expect(strokePath([])).toBe('');
  });
});

describe('parseStrokes', () => {
  const good = { id: 'a', color: '#2962ff', width: 2, points: [1, 2, 3, 4] };

  it('keeps valid strokes and drops broken ones', () => {
    const raw = JSON.stringify([
      good,
      { ...good, id: 'b', color: 'red' },
      { ...good, id: 'c', width: 7 },
      { ...good, id: 'd', points: [1, 2, 3] },
      { ...good, id: 'e', points: [1, 'x'] },
    ]);
    expect(parseStrokes(raw)).toEqual([good]);
  });

  it('survives junk', () => {
    expect(parseStrokes('{nope')).toEqual([]);
    expect(parseStrokes('{"a":1}')).toEqual([]);
    expect(parseStrokes(null)).toEqual([]);
  });
});
