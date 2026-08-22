/**
 * Image library for artwork, avatars and logo marks.
 *
 * Uploads never leave the device: files are normalised in a canvas and stored
 * in this browser's IndexedDB. There is no server and no network call, so one
 * person's images are unreachable from anyone else's browser — the origin
 * boundary is what enforces it.
 */

const DB_NAME = 'pnl-card-studio';
const DB_VERSION = 1;
const STORE = 'backgrounds';

export type ImageRole = 'artwork' | 'avatar' | 'logo';

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const ROLE_LIMITS: Record<ImageRole, { max: number; maxEdge: number }> = {
  artwork: { max: 12, maxEdge: 2600 },
  avatar: { max: 6, maxEdge: 512 },
  logo: { max: 6, maxEdge: 512 },
};

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'];
export const ACCEPT_ATTR = ACCEPTED.join(',');

export interface ImageRecord {
  id: string;
  role: ImageRole;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

export interface ImageSummary {
  id: string;
  role: ImageRole;
  name: string;
  width: number;
  height: number;
  createdAt: number;
  /** Object URL for the picker thumbnail. Revoked by `releaseThumbnails`. */
  url: string;
}

export class ImageError extends Error {}

export function maxImagesFor(role: ImageRole): number {
  return ROLE_LIMITS[role].max;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new ImageError('This browser has no IndexedDB, so uploads cannot be saved.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new ImageError('Could not open storage.'));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Records written before roles existed are artwork. */
function roleOf(record: ImageRecord): ImageRole {
  return record.role ?? 'artwork';
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // `from-image` applies EXIF orientation, so portrait phone shots stay upright.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    // The pixels are copied into a canvas below, so the URL can go now.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageError('Could not encode the image.'))),
      // WebP keeps the alpha channel, which logos and avatars need.
      'image/webp',
      0.92,
    );
  });
}

/**
 * Re-encodes the upload: caps the long edge, drops EXIF (including GPS) and
 * normalises the format.
 */
async function normalize(file: File, maxEdge: number) {
  const { source, width, height } = await decode(file);
  if (!width || !height) throw new ImageError('That file is not a readable image.');

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageError('Canvas is unavailable in this browser.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  if ('close' in source && typeof source.close === 'function') source.close();

  return { blob: await canvasToBlob(canvas), width: targetWidth, height: targetHeight };
}

export async function addImage(file: File, role: ImageRole): Promise<ImageRecord> {
  if (!ACCEPTED.includes(file.type)) {
    throw new ImageError('Use a PNG, JPEG, WebP, AVIF or GIF image.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ImageError(`That image is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }

  const limits = ROLE_LIMITS[role];
  const existing = await listImages(role);
  releaseThumbnails(existing);
  if (existing.length >= limits.max) {
    throw new ImageError(`You can keep ${limits.max} ${role} images — delete one first.`);
  }

  const { blob, width, height } = await normalize(file, limits.maxEdge);
  const record: ImageRecord = {
    id: makeId(),
    role,
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 48) || role,
    blob,
    width,
    height,
    createdAt: Date.now(),
  };
  await tx('readwrite', (store) => store.put(record));
  return record;
}

export async function getImage(id: string): Promise<ImageRecord | null> {
  const record = await tx<ImageRecord | undefined>('readonly', (store) => store.get(id));
  return record ?? null;
}

export async function listImages(role: ImageRole): Promise<ImageSummary[]> {
  const records = await tx<ImageRecord[]>('readonly', (store) => store.getAll());
  return records
    .filter((record) => roleOf(record) === role)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((record) => ({
      id: record.id,
      role: roleOf(record),
      name: record.name,
      width: record.width,
      height: record.height,
      createdAt: record.createdAt,
      url: URL.createObjectURL(record.blob),
    }));
}

export async function deleteImage(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
  const cached = imageCache.get(id);
  if (cached) {
    URL.revokeObjectURL(cached.url);
    imageCache.delete(id);
  }
}

export function releaseThumbnails(items: ImageSummary[]): void {
  for (const item of items) URL.revokeObjectURL(item.url);
}

interface CachedImage {
  url: string;
  image: HTMLImageElement;
}

const imageCache = new Map<string, CachedImage>();
const inFlight = new Map<string, Promise<HTMLImageElement | null>>();

/** Decoded image for the renderer. Cached so re-renders stay synchronous. */
export function loadImageElement(id: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(id);
  if (cached) return Promise.resolve(cached.image);

  const pending = inFlight.get(id);
  if (pending) return pending;

  const promise = (async () => {
    const record = await getImage(id);
    if (!record) return null;
    const url = URL.createObjectURL(record.blob);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
    imageCache.set(id, { url, image });
    return image;
  })().finally(() => inFlight.delete(id));

  inFlight.set(id, promise);
  return promise;
}

/** Synchronous cache hit, used by the render loop. */
export function peekImageElement(id: string): HTMLImageElement | null {
  return imageCache.get(id)?.image ?? null;
}
