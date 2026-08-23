import { describe, expect, it } from 'vitest';
import { chooseCardVersion, seedForNewCard, type LocalVersion } from './useCloudCard';
import { createDefaultState } from './defaults';
import type { RemoteCard } from './remote/cards';
import type { CardState } from '../types';

/**
 * This is where edits get lost if it is wrong, and the failure is silent: the
 * card simply reverts and nobody can say when. Worth pinning from both sides.
 */

function local(over: Partial<LocalVersion> = {}): LocalVersion {
  return { cardId: 'card-1', updatedAt: 1_000, dirty: false, ...over };
}

function remote(over: Partial<RemoteCard> = {}): RemoteCard {
  return {
    id: 'card-1',
    title: 'My card',
    state: createDefaultState(),
    updatedAt: 2_000,
    ...over,
  };
}

describe('chooseCardVersion', () => {
  it('creates a card when the account has none', () => {
    expect(chooseCardVersion(local({ cardId: null, updatedAt: 0 }), null)).toBe('create');
  });

  it('creates a card when the row this browser knew about is gone', () => {
    expect(chooseCardVersion(local({ dirty: true }), null)).toBe('create');
  });

  it('takes the account copy for a browser with nothing unsaved', () => {
    expect(chooseCardVersion(local(), remote())).toBe('adopt-remote');
  });

  it('takes the account copy even when this browser has never saved', () => {
    expect(chooseCardVersion(local({ cardId: null, updatedAt: 0 }), remote())).toBe('adopt-remote');
  });

  it('pushes unsaved edits rather than adopting a newer server copy', () => {
    // The case the `dirty` flag exists for: the server timestamp is ahead
    // precisely *because* this browser never managed to save.
    const choice = chooseCardVersion(local({ dirty: true, updatedAt: 1_000 }), remote({ updatedAt: 9_999 }));
    expect(choice).toBe('push-local');
  });

  it('pushes unsaved edits when the timestamps are identical', () => {
    expect(chooseCardVersion(local({ dirty: true, updatedAt: 2_000 }), remote({ updatedAt: 2_000 }))).toBe(
      'push-local',
    );
  });

  it('never adopts the remote copy while local work is unsaved', () => {
    // Swept rather than spot-checked: no combination of timestamps may beat
    // the dirty flag, because none of them knows about the unsaved edits.
    for (const localAt of [0, 1, 500, 2_000, 10_000]) {
      for (const remoteAt of [0, 1, 500, 2_000, 10_000]) {
        const choice = chooseCardVersion(
          local({ dirty: true, updatedAt: localAt }),
          remote({ updatedAt: remoteAt }),
        );
        expect(choice).toBe('push-local');
      }
    }
  });
});

describe('seedForNewCard', () => {
  const edited: CardState = { ...createDefaultState(), mode: 'trade' };

  it('prefers a card made before the user signed up', () => {
    const orphan: CardState = { ...createDefaultState(), mode: 'trade' };
    const seed = seedForNewCard(
      { cardId: null, state: createDefaultState(), updatedAt: 0, dirty: false },
      orphan,
    );
    expect(seed).toBe(orphan);
  });

  it('keeps unsaved local work when there is no orphan', () => {
    const seed = seedForNewCard({ cardId: null, state: edited, updatedAt: 0, dirty: true }, null);
    expect(seed).toBe(edited);
  });

  it('keeps a local card that has been saved before', () => {
    const seed = seedForNewCard({ cardId: 'gone', state: edited, updatedAt: 42, dirty: false }, null);
    expect(seed).toBe(edited);
  });

  it('falls back to the sample card for a genuinely fresh browser', () => {
    const fresh = createDefaultState();
    const seed = seedForNewCard({ cardId: null, state: fresh, updatedAt: 0, dirty: false }, null);
    expect(seed).toEqual(createDefaultState());
  });
});
