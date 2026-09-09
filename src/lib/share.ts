import type { CardState } from '../types';
import { slugify } from './format';
import { renderCardBlob } from './render';

export function cardFileName(state: CardState): string {
  const base =
    state.mode === 'trade' ? state.trade.symbol || 'trade' : state.period.title || 'period';
  return `${slugify(base, 'pnl')}-pnl.png`;
}

export async function downloadCard(state: CardState, scale: number): Promise<void> {
  const blob = await renderCardBlob(state, scale);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = cardFileName(state);
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke late: Safari reads the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canCopyImage(): boolean {
  return (
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    'write' in navigator.clipboard
  );
}

export async function copyCardToClipboard(state: CardState, scale: number): Promise<void> {
  if (!canCopyImage()) throw new Error('This browser cannot copy images to the clipboard.');
  // Safari requires the ClipboardItem to be constructed inside the same user
  // gesture, so the blob is passed as a still-pending promise.
  const item = new ClipboardItem({ 'image/png': renderCardBlob(state, scale) });
  await navigator.clipboard.write([item]);
}

export function canShareFiles(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && !!navigator.share;
}

/**
 * How far a share got. A bare boolean could not tell "you cancelled" from "the
 * browser would not take the file", and the app said the former for both — so
 * a share that never opened was reported as one the user changed their mind
 * about.
 */
export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'pending' | 'timeout';

/**
 * `navigator.share` is allowed to never settle, and on Windows Chrome it does
 * exactly that when the sheet cannot open — a window that is not focused, or
 * covered by another app, is enough. The promise then stays pending for the
 * life of the page: no resolve, no reject, no sheet.
 *
 * That is a platform bug we cannot fix, but the app must not hang on it. The
 * button was left reading "Sharing…" and disabled — along with every other
 * export button, since they share one `busy` flag — until the page was
 * reloaded. So the wait is bounded, and the caller gets `'timeout'` and can
 * say something true about it.
 */
const SHARE_TIMEOUT_MS = 12_000;

/** True while a `navigator.share` call from here has still not settled. */
let sharePending = false;

export async function shareCard(state: CardState, scale: number): Promise<ShareOutcome> {
  if (!canShareFiles()) return 'unsupported';
  if (sharePending) return 'pending';

  const blob = await renderCardBlob(state, scale);
  const file = new File([blob], cardFileName(state), { type: 'image/png' });
  if (!navigator.canShare({ files: [file] })) return 'unsupported';

  sharePending = true;
  const share = navigator
    .share({ files: [file], title: 'PnL card' })
    .then<ShareOutcome>(() => 'shared')
    .catch<ShareOutcome>((error) => {
      // The sheet opened and the person closed it: not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // A share from an earlier click is still open, or still hanging.
      if (error instanceof DOMException && error.name === 'InvalidStateError') return 'pending';
      throw error;
    })
    .finally(() => {
      sharePending = false;
    });
  // A share that fails *after* the timeout below has already answered would
  // otherwise reject with nobody listening; racing it still surfaces the
  // failure when it is the one that settles first.
  share.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ShareOutcome>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), SHARE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([share, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What to tell the person for each outcome, and whether it reads as a failure.
 * Pure, so the wording is unit-tested rather than checked by eye in a toast.
 */
export function shareMessage(outcome: ShareOutcome): { message: string; tone: 'info' | 'error' } {
  switch (outcome) {
    case 'shared':
      return { message: 'Card shared.', tone: 'info' };
    case 'cancelled':
      return { message: 'Sharing was cancelled.', tone: 'info' };
    case 'unsupported':
      return {
        message: 'This browser will not share an image file. Use Download PNG instead.',
        tone: 'error',
      };
    case 'pending':
      return {
        message: 'A share is already open. Finish or close it, then try again.',
        tone: 'error',
      };
    case 'timeout':
      return {
        message: 'The share sheet never opened — this happens in Chrome on Windows. Use Download PNG instead.',
        tone: 'error',
      };
  }
}
