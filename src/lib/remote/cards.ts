/**
 * The account's copy of the card itself — one row in `public.cards`, holding
 * the whole `CardState` as JSON.
 *
 * The table is keyed by card id and indexed by `(user_id, updated_at desc)`, so
 * an account can hold many cards even though today's UI edits exactly one. That
 * is deliberate: a card list is the obvious next feature, and retrofitting a
 * per-user singleton into a collection later would mean a data migration. Here
 * it costs one extra column.
 *
 * `updated_at` is set by a database trigger, not by the client. A browser with
 * a wrong clock would otherwise be able to make its stale copy look newer than
 * the server's and win the merge, which is exactly the case the timestamp
 * exists to settle.
 */

import type { CardState } from '../../types';
import { hydrateState } from '../defaults';
import { requireSupabase } from '../supabase';

export interface RemoteCard {
  id: string;
  title: string;
  state: CardState;
  /** Epoch ms, from the server's clock. */
  updatedAt: number;
}

interface CardRow {
  id: string;
  title: string;
  state: unknown;
  updated_at: string;
}

function fromRow(row: CardRow): RemoteCard {
  return {
    id: row.id,
    title: row.title,
    // Runs the stored JSON through the same merge a localStorage save gets, so
    // a card written by an older build of the app opens rather than breaks.
    state: hydrateState(row.state),
    updatedAt: Date.parse(row.updated_at) || 0,
  };
}

/** One specific card, or null when it has been deleted elsewhere. */
export async function fetchCard(id: string): Promise<RemoteCard | null> {
  const { data, error } = await requireSupabase()
    .from('cards')
    .select('id, title, state, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not open your card: ${error.message}`);
  return data ? fromRow(data as CardRow) : null;
}

/** The account's most recently edited card, or null for a brand new account. */
export async function fetchLatestCard(userId: string): Promise<RemoteCard | null> {
  const { data, error } = await requireSupabase()
    .from('cards')
    .select('id, title, state, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not open your cards: ${error.message}`);
  const rows = data as CardRow[];
  return rows.length > 0 && rows[0] ? fromRow(rows[0]) : null;
}

export async function createCard(
  userId: string,
  state: CardState,
  title = 'My card',
): Promise<RemoteCard> {
  const { data, error } = await requireSupabase()
    .from('cards')
    .insert({ user_id: userId, title, state })
    .select('id, title, state, updated_at')
    .single();
  if (error) throw new Error(`Could not create your card: ${error.message}`);
  return fromRow(data as CardRow);
}

/** Returns the server's new `updated_at`, which becomes the local high-water mark. */
export async function saveCard(id: string, state: CardState): Promise<number> {
  const { data, error } = await requireSupabase()
    .from('cards')
    .update({ state })
    .eq('id', id)
    .select('updated_at')
    .single();
  if (error) throw new Error(`Could not save your card: ${error.message}`);
  return Date.parse((data as { updated_at: string }).updated_at) || Date.now();
}
