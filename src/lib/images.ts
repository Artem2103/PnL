/**
 * Media library for artwork (photo or clip), avatars and logo marks.
 *
 * Uploads never leave the device: files are stored in this browser's
 * IndexedDB. There is no server and no network call, so one person's media is
 * unreachable from anyone else's browser — the origin boundary is what
 * enforces it.
 *
 * Photos are re-encoded through a canvas, which caps the long edge and drops
 * EXIF (including GPS). Video is stored byte-for-byte: re-encoding it in the
 * browser would cost minutes and quality, and a video file carries no EXIF
 * block. Its container metadata is left as the camera wrote it.
 */

const DB_NAME = 'pnl-card-studio';
const DB_VERSION = 1;
const STORE = 'backgrounds';

export type ImageRole = 'artwork' | 'avatar' | 'logo';
export type MediaKind = 'image' | 'video';

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

/** The longest slice of a clip a card will ever use. */
export const MAX_CLIP_SECONDS = 15;
/** Longer sources are refused: the card only ever shows a 15 s window. */
export const MAX_SOURCE_SECONDS = 120;

const ROLE_LIMITS: Record<ImageRole, { max: number; maxEdge: number }> = {
  artwork: { max: 12, maxEdge: 2600 },
  avatar: { max: 6, maxEdge: 512 },
  logo: { max: 6, maxEdge: 512 },
};

const ACCEPTED_IMAGE = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'];
const ACCEPTED_VIDEO = ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'];

/** Some browsers hand over an empty `type` for dragged files. */
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|ogv)$/i;

export const ACCEPT_ATTR = ACCEPTED_IMAGE.join(',');
export const ACCEPT_ATTR_WITH_VIDEO = [...ACCEPTED_IMAGE, ...ACCEPTED_VIDEO].join(',');

export function acceptAttrFor(role: ImageRole): string {
  return role === 'artwork' ? ACCEPT_ATTR_WITH_VIDEO : ACCEPT_ATTR;
}

export function isVideoFile(file: File): boolean {
  if (file.type) return file.type.startsWith('video/');
  return VIDEO_EXTENSIONS.test(file.name);
}

export interface MediaRecord {
  id: string;
  role: ImageRole;
  kind: MediaKind;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  /** Seconds; zero for stills. */
  duration: number;
  createdAt: number;
  /**
   * Video only: a still lifted from the clip when it was added. Without it the
   * picker has to mount a `<video>` per tile — a dozen decoders running to show
   * a dozen postage stamps. Absent on records written before this existed.
   */
  poster?: Blob;
}

export interface MediaSummary {
  id: string;
  role: ImageRole;
  kind: MediaKind;
  name: string;
  width: number;
  height: number;
  duration: number;
  createdAt: number;
  /** Object URL for the picker thumbnail. Revoked by `releaseThumbnails`. */
  url: string;
  /** Video only: object URL of the poster still, when the record has one. */
  posterUrl?: string;
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
function roleOf(record: MediaRecord): ImageRole {
  return record.role ?? 'artwork';
}

/** Records written before video existed are stills. */
function kindOf(record: MediaRecord): MediaKind {
  return record.kind === 'video' ? 'video' : 'image';
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

/* ------------------------------------------------------------------ */
/* Video                                                               */
/* ------------------------------------------------------------------ */

/** A `<video>` wired for silent, off-screen use. */
export function makeVideoElement(src: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = src;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // No crossOrigin: the source is a same-origin blob URL, so the canvas stays
  // untainted and `captureStream` keeps working.
  // Keeps iOS from taking the clip fullscreen when it plays.
  video.setAttribute('playsinline', '');
  return video;
}

function onceEvent(target: EventTarget, name: string): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      target.removeEventListener(name, handler);
      resolve();
    };
    target.addEventListener(name, handler);
  });
}

/**
 * Waits for `<video>` metadata, with the seek trick that forces a real
 * duration out of streamed WebM files (they report `Infinity` until the
 * browser has been asked to seek past the end).
 */
export async function readVideoMetadata(
  video: HTMLVideoElement,
): Promise<{ width: number; height: number; duration: number }> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ImageError('That video took too long to open. Try a shorter clip.')),
      20_000,
    );
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', ok);
      video.removeEventListener('error', fail);
    };
    const ok = () => {
      done();
      resolve();
    };
    const fail = () => {
      done();
      reject(
        new ImageError('This browser cannot decode that video. Try an MP4 (H.264) or WebM file.'),
      );
    };
    if (video.readyState >= 1) {
      clearTimeout(timer);
      resolve();
      return;
    }
    video.addEventListener('loadedmetadata', ok);
    video.addEventListener('error', fail);
  });

  let duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    video.currentTime = 1e9;
    // A file the decoder cannot seek fires neither event, and the picker would
    // sit on "Processing…" for the rest of the session waiting for one.
    await Promise.race([onceEvent(video, 'timeupdate'), onceEvent(video, 'seeked'), sleep(8000)]);
    duration = video.duration;
    video.currentTime = 0;
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new ImageError('That video has no readable duration.');
  }

  return { width: video.videoWidth, height: video.videoHeight, duration };
}

/** Longest edge of the poster still kept for the picker. */
const POSTER_MAX_EDGE = 320;

/**
 * A frame from just inside the clip, scaled down for the picker. Best effort:
 * a clip that will not seek or paint still uploads fine, the tile just falls
 * back to a `<video>` for that one record.
 */
async function capturePoster(
  video: HTMLVideoElement,
  width: number,
  height: number,
  duration: number,
): Promise<Blob | undefined> {
  try {
    const at = Math.min(Math.max(0.1, duration * 0.05), Math.max(0, duration - 0.05));
    if (Math.abs(video.currentTime - at) > 0.01) {
      const seeked = Promise.race([onceEvent(video, 'seeked'), sleep(4000)]);
      video.currentTime = at;
      await seeked;
    }
    if (video.readyState < 2) await Promise.race([onceEvent(video, 'loadeddata'), sleep(4000)]);
    if (video.readyState < 2) return undefined;

    const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } catch {
    return undefined;
  }
}

async function probeVideo(
  file: File,
): Promise<{ width: number; height: number; duration: number; poster?: Blob }> {
  const url = URL.createObjectURL(file);
  const video = makeVideoElement(url);
  try {
    const meta = await readVideoMetadata(video);
    if (!meta.width || !meta.height) {
      throw new ImageError('That video has no readable picture.');
    }
    if (meta.duration > MAX_SOURCE_SECONDS) {
      throw new ImageError(
        `That clip is ${Math.round(meta.duration)} s. Use one under ${MAX_SOURCE_SECONDS} s — ` +
          `the card plays at most ${MAX_CLIP_SECONDS} s of it.`,
      );
    }
    const poster = await capturePoster(video, meta.width, meta.height, meta.duration);
    return { ...meta, poster };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export async function addImage(file: File, role: ImageRole): Promise<MediaRecord> {
  const video = isVideoFile(file);

  if (video && role !== 'artwork') {
    throw new ImageError('Video can only be used as the background.');
  }
  if (!video && !ACCEPTED_IMAGE.includes(file.type)) {
    throw new ImageError(
      role === 'artwork'
        ? 'Use a PNG, JPEG, WebP, AVIF or GIF image, or an MP4 / WebM clip.'
        : 'Use a PNG, JPEG, WebP, AVIF or GIF image.',
    );
  }

  const cap = video ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
  if (file.size > cap) {
    throw new ImageError(`That file is larger than ${Math.round(cap / 1024 / 1024)} MB.`);
  }

  const limits = ROLE_LIMITS[role];
  const existing = await listImages(role);
  releaseThumbnails(existing);
  if (existing.length >= limits.max) {
    throw new ImageError(`You can keep ${limits.max} ${role} files — delete one first.`);
  }

  const media = video
    ? { ...(await probeVideo(file)), blob: file as Blob }
    : { ...(await normalize(file, limits.maxEdge)), duration: 0, poster: undefined };

  const record: MediaRecord = {
    id: makeId(),
    role,
    kind: video ? 'video' : 'image',
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 48) || role,
    blob: media.blob,
    width: media.width,
    height: media.height,
    duration: media.duration,
    createdAt: Date.now(),
    poster: media.poster,
  };
  await tx('readwrite', (store) => store.put(record));
  return record;
}

export async function getImage(id: string): Promise<MediaRecord | null> {
  const record = await tx<MediaRecord | undefined>('readonly', (store) => store.get(id));
  return record ?? null;
}

export async function listImages(role: ImageRole): Promise<MediaSummary[]> {
  const records = await tx<MediaRecord[]>('readonly', (store) => store.getAll());
  return records
    .filter((record) => roleOf(record) === role)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((record) => ({
      id: record.id,
      role: roleOf(record),
      kind: kindOf(record),
      name: record.name,
      width: record.width,
      height: record.height,
      duration: record.duration ?? 0,
      createdAt: record.createdAt,
      url: URL.createObjectURL(record.blob),
      posterUrl: record.poster ? URL.createObjectURL(record.poster) : undefined,
    }));
}

export async function deleteImage(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
  const cached = mediaCache.get(id);
  if (cached) {
    if (cached.media.element instanceof HTMLVideoElement) {
      cached.media.element.pause();
      cached.media.element.removeAttribute('src');
      cached.media.element.load();
    }
    URL.revokeObjectURL(cached.url);
    mediaCache.delete(id);
  }
}

export function releaseThumbnails(items: MediaSummary[]): void {
  for (const item of items) {
    URL.revokeObjectURL(item.url);
    if (item.posterUrl) URL.revokeObjectURL(item.posterUrl);
  }
}

/* ------------------------------------------------------------------ */
/* Decoded elements for the renderer                                   */
/* ------------------------------------------------------------------ */

export interface Media {
  id: string;
  kind: MediaKind;
  element: HTMLImageElement | HTMLVideoElement;
  width: number;
  height: number;
  duration: number;
}

const mediaCache = new Map<string, { url: string; media: Media }>();
const inFlight = new Map<string, Promise<Media | null>>();

async function decodeRecord(record: MediaRecord, url: string): Promise<Media | null> {
  if (kindOf(record) === 'video') {
    const video = makeVideoElement(url);
    try {
      const meta = await readVideoMetadata(video);
      // `loadeddata` guarantees drawImage has a frame to copy.
      if (video.readyState < 2) await Promise.race([onceEvent(video, 'loadeddata'), sleep(8000)]);
      return {
        id: record.id,
        kind: 'video',
        element: video,
        width: meta.width || record.width,
        height: meta.height || record.height,
        duration: meta.duration || record.duration || 0,
      };
    } catch {
      return null;
    }
  }

  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return null;
  }
  return {
    id: record.id,
    kind: 'image',
    element: image,
    width: image.naturalWidth || record.width,
    height: image.naturalHeight || record.height,
    duration: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Decoded media for the renderer. Cached so re-renders stay synchronous. */
export function loadMedia(id: string): Promise<Media | null> {
  const cached = mediaCache.get(id);
  if (cached) return Promise.resolve(cached.media);

  const pending = inFlight.get(id);
  if (pending) return pending;

  const promise = (async () => {
    const record = await getImage(id);
    if (!record) return null;
    const url = URL.createObjectURL(record.blob);
    const media = await decodeRecord(record, url);
    if (!media) {
      URL.revokeObjectURL(url);
      return null;
    }
    mediaCache.set(id, { url, media });
    return media;
  })().finally(() => inFlight.delete(id));

  inFlight.set(id, promise);
  return promise;
}

/** Synchronous cache hit, used by the render loop. */
export function peekMedia(id: string): Media | null {
  return mediaCache.get(id)?.media ?? null;
}

export async function loadImageElement(id: string): Promise<HTMLImageElement | null> {
  const media = await loadMedia(id);
  return media && media.element instanceof HTMLImageElement ? media.element : null;
}

export function peekImageElement(id: string): HTMLImageElement | null {
  const media = peekMedia(id);
  return media && media.element instanceof HTMLImageElement ? media.element : null;
}

/**
 * A private `<video>` for the exporter, so seeking and playing during a
 * recording never disturbs the clip the preview is showing.
 */
export async function openVideoForExport(
  id: string,
): Promise<{ element: HTMLVideoElement; duration: number; release: () => void } | null> {
  const record = await getImage(id);
  if (!record || kindOf(record) !== 'video') return null;
  const url = URL.createObjectURL(record.blob);
  const element = makeVideoElement(url);
  try {
    const meta = await readVideoMetadata(element);
    return {
      element,
      duration: meta.duration || record.duration || 0,
      release: () => {
        element.pause();
        element.removeAttribute('src');
        element.load();
        URL.revokeObjectURL(url);
      },
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
