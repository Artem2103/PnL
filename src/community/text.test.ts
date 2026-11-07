import { describe, expect, it } from 'vitest';
import { canPublish, handleFrom, isValidHandle, MAX_BODY, tagsIn, timeAgo, tokenize } from './text';

describe('handles', () => {
  it('follow the same rule as the database', () => {
    expect(isValidHandle('cold_77')).toBe(true);
    expect(isValidHandle('ab')).toBe(false);
    expect(isValidHandle('Has Caps')).toBe(false);
    expect(isValidHandle('astra')).toBe(false);
  });

  it('come from the chosen name, or a neutral fallback', () => {
    expect(handleFrom('Artem L', 'abcd-1234')).toBe('artem' + 'l');
    expect(handleFrom('', 'abcd-1234')).toBe('traderabcd');
    expect(handleFrom('Ж', 'abcd-1234')).toBe('traderabcd');
    expect(handleFrom('Admin', 'abcd-1234')).toBe('traderabcd');
  });
});

describe('a post', () => {
  it('needs words or a picture, within the limit', () => {
    expect(canPublish('   ', 0)).toBe(false);
    expect(canPublish('   ', 1)).toBe(true);
    expect(canPublish('x'.repeat(MAX_BODY + 1), 1)).toBe(false);
  });

  it('splits tags, tickers and mentions out of the text', () => {
    expect(tokenize('long $EURUSD #ICT thanks @Cold77')).toEqual([
      { kind: 'text', text: 'long ' },
      { kind: 'tag', text: '$EURUSD', tag: '$eurusd' },
      { kind: 'text', text: ' ' },
      { kind: 'tag', text: '#ICT', tag: '#ict' },
      { kind: 'text', text: ' thanks ' },
      { kind: 'mention', text: '@Cold77', handle: 'cold77' },
    ]);
  });

  it('does not read money or a mid-word mark as a tag', () => {
    expect(tagsIn('made $500 on a#b today')).toEqual([]);
    expect(tagsIn('#ict and #ICT')).toEqual(['#ict']);
  });

  it('keeps every character of the text', () => {
    const body = 'one\n\n#two  three @four_ five';
    expect(tokenize(body).map((t) => t.text).join('')).toBe(body);
  });

  it('says how old it is', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    const ago = (ms: number) => timeAgo(new Date(now - ms).toISOString(), now);
    expect(ago(20_000)).toBe('now');
    expect(ago(5 * 60_000)).toBe('5m');
    expect(ago(3 * 3_600_000)).toBe('3h');
    expect(ago(2 * 86_400_000)).toBe('2d');
    expect(ago(30 * 86_400_000)).toContain('2026');
  });
});
