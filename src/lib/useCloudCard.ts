/**
 * The card state, kept in step with the account.
 *
 * Replaces the old `loadState` / `saveState` pair, and keeps their best
 * property: the editor still paints from `localStorage` on the very first
 * frame, before any network call. The account is reconciled behind it. Waiting
 * on a round trip to show a card this browser already has would make every
 * reload feel slower than the version without accounts — not a trade worth
 * making for correctness that arrives 200 ms later anyway.
 *
 * The decision that matters is `chooseCardVersion`, which is pure and tested.
 * Everything else here is plumbing around it.
 *
 * Last-write-wins is the deliberate limit. Two devices editing the same card at
 * once will have one overwrite the other, and nothing here pretends otherwise —
 * real merging needs per-field history, which is a great deal of machinery for
 * a single-user card editor.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { CardState } from '../types';
import {
  createDefaultState,
  loadLocalCard,
  saveLocalCard,
  takeOrphanCard,
  type CardSnapshot,
} from './defaults';
import { createCard, fetchCard, fetchLatestCard, saveCard, type RemoteCard } from './remote/cards';
import { isSupabaseConfigured } from './supabase';

export type CardSyncStatus =
  /** First reconciliation with the account is still running. */
  | 'loading'
  /** Everything here is in the account. */
  | 'saved'
  /** A save is in flight. */
  | 'saving'
  /** The last save failed; the edits are safe locally and will retry. */
  | 'error'
  /** No Supabase configured — this browser is the only copy. */
  | 'local';

/** Long enough that a sentence being typed is one save, short enough that
 *  closing the tab shortly after a change does not lose it. */
const SAVE_DEBOUNCE_MS = 900;

/* ------------------------------------------------------------------ */
/* The merge policy                                                    */
/* ------------------------------------------------------------------ */

export type CardChoice =
  /** Take the account's copy; this browser's is stale or identical. */
  | 'adopt-remote'
  /** This browser has edits the account has not got; push them into that row. */
  | 'push-local'
  /** Nothing to merge with — write this browser's state to a new row. */
  | 'create';

/** What this browser knows before it has talked to the account. */
export interface LocalVersion {
  cardId: string | null;
  updatedAt: number;
  dirty: boolean;
}

/**
 * Which copy wins.
 *
 * `remote` is the row this browser's `cardId` points at, or null when there is
 * no such row — either this browser has never saved, or the card was deleted
 * from another device.
 *
 * Two rules, and the order between them is the whole point:
 *
 * 1. **Unsaved local edits always win.** `updatedAt` only moves when a save
 *    succeeds, so a browser holding edits that never reached the server has an
 *    `updatedAt` *behind* the server's. Comparing timestamps first would read
 *    that as "stale" and throw the edits away — the exact case `dirty` exists
 *    to catch.
 * 2. **Otherwise the account wins.** With no unsaved work here, the account is
 *    by definition at least as new: this browser's `updatedAt` came from a
 *    successful save, and the server's clock only moves forward.
 *
 * Dirty edits with no row to push them into become a new card rather than
 * being dropped. Losing work to a card someone deleted on their phone would be
 * the worst outcome available.
 */
export function chooseCardVersion(local: LocalVersion, remote: RemoteCard | null): CardChoice {
  if (!remote) return 'create';
  if (local.dirty) return 'push-local';
  return 'adopt-remote';
}

/**
 * Which state seeds a brand new row. A card made before signing up is worth
 * more than the defaults, and a local card with history is worth more than a
 * blank one.
 */
export function seedForNewCard(local: CardSnapshot, orphan: CardState | null): CardState {
  if (orphan) return orphan;
  if (local.dirty || local.updatedAt > 0) return local.state;
  return createDefaultState();
}

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

interface Resolved {
  cardId: string;
  state: CardState;
  updatedAt: number;
}

/**
 * Shared across mounts so React's StrictMode double-effect in development does
 * not create two card rows for one account.
 */
const resolving = new Map<string, Promise<Resolved>>();

async function resolveCard(userId: string, local: CardSnapshot): Promise<Resolved> {
  const pending = resolving.get(userId);
  if (pending) return pending;

  const promise = (async () => {
    // A card made before this browser had ever signed in. Read once and
    // removed, so the first account to arrive adopts it and later ones start
    // clean — the same rule `claimOrphans` uses for media.
    const orphan = takeOrphanCard();

    // The row this browser was editing, if it still exists. Falling back to the
    // account's newest card covers a fresh browser and a card deleted
    // elsewhere with one query.
    const remote = local.cardId
      ? ((await fetchCard(local.cardId)) ?? (await fetchLatestCard(userId)))
      : await fetchLatestCard(userId);

    // Local edits belong to a row that has gone. Pushing them into whatever
    // card happens to be newest would write them into the wrong card, so they
    // get one of their own.
    const orphanedEdits = local.dirty && local.cardId !== null && remote?.id !== local.cardId;

    const choice = orphanedEdits ? 'create' : chooseCardVersion(local, remote);

    switch (choice) {
      case 'create': {
        const created = await createCard(userId, seedForNewCard(local, orphan));
        return { cardId: created.id, state: created.state, updatedAt: created.updatedAt };
      }
      case 'push-local': {
        const updatedAt = await saveCard(remote!.id, local.state);
        return { cardId: remote!.id, state: local.state, updatedAt };
      }
      case 'adopt-remote':
      default:
        return { cardId: remote!.id, state: remote!.state, updatedAt: remote!.updatedAt };
    }
  })().finally(() => resolving.delete(userId));

  resolving.set(userId, promise);
  return promise;
}

export interface CloudCard {
  state: CardState;
  setState: Dispatch<SetStateAction<CardState>>;
  status: CardSyncStatus;
  /** Populated when `status` is `'error'`, for the toast. */
  error: string | null;
}

export function useCloudCard(userId: string): CloudCard {
  const [state, setStateInner] = useState<CardState>(() => loadLocalCard(userId).state);
  const [status, setStatus] = useState<CardSyncStatus>(isSupabaseConfigured ? 'loading' : 'local');
  const [error, setError] = useState<string | null>(null);

  const cardIdRef = useRef<string | null>(null);
  const updatedAtRef = useRef(0);
  /**
   * Distinguishes "the user changed this" from "the loader put it there".
   * Without it the reconciliation's own `setState` would look like an edit and
   * be written straight back to the server it just came from.
   */
  const dirtyRef = useRef(false);

  const persistLocal = useCallback(
    (next: CardState, dirty: boolean) => {
      saveLocalCard(userId, {
        cardId: cardIdRef.current,
        state: next,
        updatedAt: updatedAtRef.current,
        dirty,
      });
    },
    [userId],
  );

  // ------------------------------------------------------------ first load
  useEffect(() => {
    if (!isSupabaseConfigured || !userId) {
      setStatus('local');
      return;
    }
    let cancelled = false;
    const local = loadLocalCard(userId);
    cardIdRef.current = local.cardId;
    updatedAtRef.current = local.updatedAt;

    void resolveCard(userId, local).then(
      (resolved) => {
        if (cancelled) return;
        cardIdRef.current = resolved.cardId;
        updatedAtRef.current = resolved.updatedAt;

        // Typing during the round trip is not rare on a slow connection, and
        // overwriting what is on screen with what the server had a moment ago
        // would eat those keystrokes. The save effect is already pending and
        // will push them.
        if (dirtyRef.current) {
          setStatus('saving');
          return;
        }

        setStateInner(resolved.state);
        saveLocalCard(userId, {
          cardId: resolved.cardId,
          state: resolved.state,
          updatedAt: resolved.updatedAt,
          dirty: false,
        });
        setStatus('saved');
      },
      (caught: unknown) => {
        if (cancelled) return;
        // The card on screen is the cached one and stays editable; only the
        // account copy is unavailable, and the next edit retries the save.
        setError(caught instanceof Error ? caught.message : 'Could not reach your account.');
        setStatus('error');
      },
    );

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // --------------------------------------------------------------- saving
  useEffect(() => {
    if (!dirtyRef.current) return;

    // Written synchronously, every time, debounce or not: a tab closed two
    // keystrokes after an edit must still find the edit here on reopening.
    persistLocal(state, true);

    if (!isSupabaseConfigured || !userId) return;

    const timer = setTimeout(() => {
      const cardId = cardIdRef.current;
      // Still resolving which card this is. `resolveCard` sees `dirty` in the
      // snapshot this effect just wrote and pushes it, so nothing is lost by
      // skipping this round.
      if (!cardId) return;

      setStatus('saving');
      void saveCard(cardId, state).then(
        (updatedAt) => {
          updatedAtRef.current = updatedAt;
          persistLocal(state, false);
          setError(null);
          setStatus('saved');
        },
        (caught: unknown) => {
          setError(caught instanceof Error ? caught.message : 'Could not save your card.');
          setStatus('error');
        },
      );
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [persistLocal, state, userId]);

  const setState = useCallback<Dispatch<SetStateAction<CardState>>>((action) => {
    dirtyRef.current = true;
    setStateInner(action);
  }, []);

  return { state, setState, status, error };
}
