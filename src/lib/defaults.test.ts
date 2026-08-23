import { beforeEach, describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  clearLocalCard,
  createDefaultState,
  loadLocalCard,
  saveLocalCard,
  takeOrphanCard,
} from './defaults';

/**
 * The per-account cache. Two people sharing a browser is the case that has to
 * be right — one seeing the other's card would be a privacy failure, not just
 * a bug.
 */

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

beforeEach(() => storage.clear());

describe('the per-account card cache', () => {
  it('returns the sample card for an account that has never saved', () => {
    const snapshot = loadLocalCard('user-a');
    expect(snapshot.cardId).toBeNull();
    expect(snapshot.updatedAt).toBe(0);
    expect(snapshot.dirty).toBe(false);
    expect(snapshot.state).toEqual(createDefaultState());
  });

  it('round-trips a snapshot', () => {
    const state = { ...createDefaultState(), mode: 'trade' as const };
    saveLocalCard('user-a', { cardId: 'card-1', state, updatedAt: 1234, dirty: true });

    const back = loadLocalCard('user-a');
    expect(back.cardId).toBe('card-1');
    expect(back.updatedAt).toBe(1234);
    expect(back.dirty).toBe(true);
    expect(back.state.mode).toBe('trade');
  });

  it('keeps two accounts on one browser apart', () => {
    saveLocalCard('user-a', {
      cardId: 'card-a',
      state: { ...createDefaultState(), mode: 'trade' },
      updatedAt: 10,
      dirty: false,
    });

    const other = loadLocalCard('user-b');
    expect(other.cardId).toBeNull();
    expect(other.state).toEqual(createDefaultState());
  });

  it('clears one account without touching the other', () => {
    const snapshot = { cardId: 'x', state: createDefaultState(), updatedAt: 5, dirty: false };
    saveLocalCard('user-a', snapshot);
    saveLocalCard('user-b', { ...snapshot, cardId: 'y' });

    clearLocalCard('user-a');

    expect(loadLocalCard('user-a').cardId).toBeNull();
    expect(loadLocalCard('user-b').cardId).toBe('y');
  });

  it('survives a corrupted entry rather than throwing', () => {
    storage.setItem(`${STORAGE_KEY}:user-a`, '{not json');
    expect(loadLocalCard('user-a').state).toEqual(createDefaultState());
  });

  it('merges a snapshot written by an older build over current defaults', () => {
    storage.setItem(
      `${STORAGE_KEY}:user-a`,
      JSON.stringify({ cardId: 'card-1', state: { mode: 'trade', gone: true } }),
    );
    const back = loadLocalCard('user-a');
    expect(back.state.mode).toBe('trade');
    expect(back.state.brand).toEqual(createDefaultState().brand);
    expect(back.updatedAt).toBe(0);
  });
});

describe('takeOrphanCard', () => {
  it('is null when there is nothing from before accounts existed', () => {
    expect(takeOrphanCard()).toBeNull();
  });

  it('returns the pre-account card and hands it over exactly once', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'trade' }));

    const first = takeOrphanCard();
    expect(first?.mode).toBe('trade');
    // Removed on read, so a second account signing in on this browser starts
    // clean instead of inheriting the first one's card.
    expect(takeOrphanCard()).toBeNull();
  });

  it('does not mistake a per-account key for the orphan', () => {
    saveLocalCard('user-a', {
      cardId: 'card-a',
      state: createDefaultState(),
      updatedAt: 1,
      dirty: false,
    });
    expect(takeOrphanCard()).toBeNull();
    expect(loadLocalCard('user-a').cardId).toBe('card-a');
  });
});
