import { clearTextMetricsCache } from './canvas/primitives';

/**
 * Canvas text falls back to a system font if the webfont has not loaded yet,
 * which would make the preview and a later export differ. Everything that
 * paints waits on this first.
 *
 * Only the faces the *card* draws with are listed. The editor's own type
 * (JetBrains Mono, the heavier Inter weights used by buttons and headings)
 * loads on its own through CSS and must not hold the first card paint back —
 * awaiting `document.fonts.ready` would have done exactly that.
 */
const REQUIRED = [
  /** Wordmark. */
  '300 24px Inter',
  /** Title, rows, handle, footer. */
  '400 24px Inter',
  /** The value inside the accent block. */
  '800 64px Inter',
];

/**
 * A font server that never answers must not leave the card blank. Past this,
 * the card paints in the fallback stack and repaints itself when the real face
 * turns up.
 */
const FONT_TIMEOUT_MS = 2500;

let ready: Promise<void> | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  // Every cached measurement was taken against the face that was resolved at
  // the time, so both have to go together.
  clearTextMetricsCache();
  for (const listener of listeners) listener();
}

/**
 * Fires whenever a webfont finishes loading after the first paint, so anything
 * already on screen can repaint against the real metrics. Returns an
 * unsubscribe.
 */
export function onFontsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let watching = false;

function watchLateArrivals(): void {
  if (watching || typeof document === 'undefined' || !('fonts' in document)) return;
  watching = true;
  document.fonts.addEventListener('loadingdone', announce);
}

export function ensureFonts(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    watchLateArrivals();
    // Never rejects: offline, the fallback stack renders — consistently, in
    // both the preview and the export, which is what actually matters.
    const loaded = Promise.all(
      REQUIRED.map((font) => document.fonts.load(font, '0123456789+%$').catch(() => undefined)),
    ).then(() => undefined);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS));
    await Promise.race([loaded, timeout]);
    // If the timeout won, the load is still running. Whenever it lands, the
    // stale metrics are dropped and anything on screen repaints itself.
    void loaded.then(announce);
  })();
  return ready;
}

export function fontsSettled(): boolean {
  if (typeof document === 'undefined' || !('fonts' in document)) return true;
  return document.fonts.status === 'loaded';
}
