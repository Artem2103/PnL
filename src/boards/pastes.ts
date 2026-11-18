import { connection } from '../lib/idb';

/**
 * Images pasted onto the board (Ctrl/⌘+V). Local only: the files are kept in
 * this browser's IndexedDB and never uploaded or shown to anyone else.
 * Positions and sizes are in board coordinates, like the drawings.
 */

export interface Paste {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  blob: Blob;
}

/** A pasted image as shown: the stored record plus an object URL for <img>. */
export interface ShownPaste extends Paste {
  url: string;
}

/** A new paste is at most this wide/tall on screen when it lands. */
export const PASTE_MAX_SCREEN = 520;
/** Smallest a paste can be resized to, in board px. */
export const PASTE_MIN = 24;

const db = connection({
  name: 'astra-board-pastes',
  store: 'pastes',
  create: (database) => database.createObjectStore('pastes', { keyPath: 'id' }),
  openError: (cause) => new Error(`Could not open local image storage: ${String(cause)}`),
});

const isPaste = (value: unknown): value is Paste => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Paste>;
  return (
    typeof p.id === 'string' &&
    [p.x, p.y, p.w, p.h].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (p.w ?? 0) > 0 &&
    (p.h ?? 0) > 0 &&
    p.blob instanceof Blob
  );
};

export async function loadPastes(): Promise<Paste[]> {
  try {
    const all = await db.run<unknown[]>('readonly', (store) => store.getAll());
    return all.filter(isPaste);
  } catch {
    return [];
  }
}

export async function savePaste({ id, x, y, w, h, blob }: Paste): Promise<void> {
  await db.run('readwrite', (store) => store.put({ id, x, y, w, h, blob }));
}

export async function deletePaste(id: string): Promise<void> {
  await db.run('readwrite', (store) => store.delete(id));
}

export async function clearPastes(): Promise<void> {
  await db.run('readwrite', (store) => store.clear());
}

/**
 * Where a freshly pasted image goes: centred on `at` (board coordinates),
 * shrunk so it is no bigger than PASTE_MAX_SCREEN on screen at zoom `z`,
 * and never enlarged past its own pixel size.
 */
export function placePaste(naturalW: number, naturalH: number, at: { x: number; y: number }, z: number) {
  const nw = Math.max(1, naturalW);
  const nh = Math.max(1, naturalH);
  // On screen: natural size, or PASTE_MAX_SCREEN on the long side if that is smaller.
  const fit = Math.min(1, PASTE_MAX_SCREEN / Math.max(nw, nh)) / z;
  const w = Math.max(PASTE_MIN, nw * fit);
  const h = Math.max(PASTE_MIN, (nh * w) / nw);
  return { x: at.x - w / 2, y: at.y - h / 2, w, h };
}

/** Resizing from the bottom-right corner keeps the picture's proportions. */
export function resizePaste(w0: number, h0: number, dx: number, dy: number) {
  const ratio = h0 / w0;
  // Follow whichever way the corner moved further, in the picture's own proportion.
  const byX = w0 + dx;
  const byY = (h0 + dy) / ratio;
  const w = Math.max(PASTE_MIN, Math.abs(dx) >= Math.abs(dy / ratio) ? byX : byY);
  return { w, h: w * ratio };
}

/** The first image on the clipboard, or null. */
export function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/** The picture's pixel size, read by decoding it. */
export function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('That clipboard image could not be read.'));
    img.src = url;
  });
}

let counter = 0;
export const pasteId = () => `p-${Date.now().toString(36)}-${(counter++).toString(36)}`;
