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

export async function shareCard(state: CardState, scale: number): Promise<boolean> {
  if (!canShareFiles()) return false;
  const blob = await renderCardBlob(state, scale);
  const file = new File([blob], cardFileName(state), { type: 'image/png' });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: 'PnL card' });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
}
