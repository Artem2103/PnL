/**
 * Turns journal numbers into a card for the existing renderer. The card's look
 * — background, colours, frame, handle, avatar — is whatever the person last
 * set in the editor; only the numbers come from the journal.
 */

import type { CardState } from '../types';
import { loadLocalCard } from '../lib/defaults';
import { fetchLatestCard } from '../lib/remote/cards';
import { isSupabaseConfigured } from '../lib/supabase';
import { LOCAL_USER_ID } from '../lib/auth';
import { displaySymbol, LOGOS, normalizeSymbol } from './symbols';
import type { Period, Trade } from './types';

export type ShareSubject =
  | { kind: 'trade'; trade: Trade; pct: number }
  | { kind: 'period'; title: string; startBalance: number; endBalance: number };

export function journalCardState(design: CardState, subject: ShareSubject, currency: string): CardState {
  const brand = { ...design.brand, currency };
  if (subject.kind === 'period') {
    return {
      ...design,
      brand,
      mode: 'period',
      period: {
        title: subject.title,
        startBalance: subject.startBalance,
        endBalance: subject.endBalance,
      },
    };
  }
  const { trade, pct } = subject;
  return {
    ...design,
    brand,
    mode: 'trade',
    trade: {
      symbol: displaySymbol(trade.symbol),
      direction: trade.side === 'buy' ? 'long' : 'short',
      // Lots, not leverage: the card prints "Long" without a multiplier.
      leverage: 1,
      entryPrice: trade.entryPrice,
      exitPrice: trade.closePrice ?? trade.entryPrice,
      pnl: trade.pnl,
      pnlPct: pct,
      logoUrl: LOGOS.get(normalizeSymbol(trade.symbol)) ?? null,
      showDirectionInTitle: true,
    },
  };
}

/** The card title for the performance panel's share. */
export function periodCardTitle(period: Period): string {
  return period === 'max' ? 'All-time Realized' : `${period.toUpperCase()} Realized`;
}

/**
 * The person's card design: this browser's copy, or the account's when that
 * one is newer and this browser holds no unsaved edits.
 */
export async function loadCardDesign(userId: string): Promise<CardState> {
  const local = loadLocalCard(userId);
  if (!isSupabaseConfigured || userId === LOCAL_USER_ID || local.dirty) return local.state;
  try {
    const remote = await fetchLatestCard(userId);
    if (remote && remote.updatedAt > local.updatedAt) return remote.state;
  } catch {
    /* The local copy, or the sample card, is still a card. */
  }
  return local.state;
}
