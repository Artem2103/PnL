import { describe, expect, it } from 'vitest';
import { cardFileName, shareMessage, type ShareOutcome } from './share';
import { createDefaultState } from './defaults';

describe('cardFileName', () => {
  it('names a trade card after its symbol', () => {
    const state = { ...createDefaultState(), mode: 'trade' as const };
    expect(cardFileName(state)).toMatch(/-pnl\.png$/);
  });
});

describe('shareMessage', () => {
  it('calls a cancelled share cancelled, and nothing else', () => {
    expect(shareMessage('cancelled')).toEqual({ message: 'Sharing was cancelled.', tone: 'info' });
    // The bug this replaces: every non-share reported as a cancellation, so a
    // sheet that never opened read as one the person had closed on purpose.
    for (const outcome of ['unsupported', 'pending', 'timeout'] as ShareOutcome[]) {
      expect(shareMessage(outcome).message).not.toContain('cancelled');
      expect(shareMessage(outcome).tone).toBe('error');
    }
  });

  it('points at the PNG when the browser will not share a file', () => {
    expect(shareMessage('unsupported').message).toContain('Download PNG');
    expect(shareMessage('timeout').message).toContain('Download PNG');
  });

  it('reports a successful share quietly', () => {
    expect(shareMessage('shared').tone).toBe('info');
  });
});
