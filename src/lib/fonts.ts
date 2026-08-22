/**
 * Canvas text falls back to a system font if the webfont has not loaded yet,
 * which would make the preview and a later export differ. Everything that
 * paints waits on this first.
 */
const REQUIRED = [
  '500 24px Inter',
  '600 24px Inter',
  '700 24px Inter',
  '800 64px Inter',
  '500 24px "JetBrains Mono"',
  '700 24px "JetBrains Mono"',
];

let ready: Promise<void> | null = null;

export function ensureFonts(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    try {
      await Promise.all(REQUIRED.map((font) => document.fonts.load(font, '0123456789+%$')));
      await document.fonts.ready;
    } catch {
      /* Offline: the fallback stack renders, consistently, in both paths. */
    }
  })();
  return ready;
}

export function fontsSettled(): boolean {
  if (typeof document === 'undefined' || !('fonts' in document)) return true;
  return document.fonts.status === 'loaded';
}
