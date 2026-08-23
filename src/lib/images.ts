/**
 * Local half of the media library: artwork (photo or clip), avatars and logos.
 *
 * This file is a **cache**, not the source of truth. Since media became
 * account-backed, the durable copy lives in the account's Supabase Storage
 * bucket and `lib/library.ts` is what the app talks to. IndexedDB stays in
 * front of it because the renderer needs blob URLs — decoding a background
 * over the network on every frame is not a thing that can work — and because
 * re-downloading an 80 MB clip on every reload would be absurd.
 *
 * Two consequences shape everything below:
 *
 * 1. A record may exist **without its bytes**. That is what a file uploaded on
 *    another device looks like here until something asks to draw it. Such a
 *    record has metadata and a `storagePath` but no `blob`; `loadMedia` fills
 *    it in through the resolver `library.ts` installs.
 * 2. Records are scoped by `userId`. Nothing here is ever listed for an
 *    account that does not own it, and `purgeUser` empties the cache on sign
 *    out so a shared browser does not keep the last person's uploads.
 *
 * Deliberately no Supabase import: keeping the network on the other side of
 * `setBlobResolver` is what lets this file be reasoned about (and opened in a
 * test) without a client, and stops the cache and the transport from growing
 * into each other.
 *
 * Photos are still re-encoded through a canvas on the way in, which caps the
 * long edge and drops EXIF (including GPS) — so that happens before anything
 * is uploaded, not after. Video is stored byte-for-byte: re-encoding it in the
 * browser would cost minutes and quality, and a video file carries no EXIF
 * block. Its container metadata is left as the camera wrote it, and now it
 * leaves the device, which is worth knowing.
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
  /**
   * The account this belongs to. Empty on records written before accounts
   * existed — `claimOrphans` hands those to the first account that signs in,
   * so a returning user keeps the library they built anonymously.
   */
  userId: string;
  role: ImageRole;
  kind: MediaKind;
  name: string;
  /**
   * Absent when the account's manifest knows about this file but this browser
   * has not downloaded it — the normal state for anything uploaded on another
   * device. `ensureBlob` is what turns that into bytes.
   */
  blob?: Blob;
  /** Kept so the blob can be re-created with the right type after a download. */
  mimeType: string;
  byteSize: number;
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
  /** Object path in the account's bucket; unset until the upload lands. */
  storagePath?: string;
  posterPath?: string;
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
  /**
   * Thumbnail source. An object URL when the bytes are cached here, a signed
   * Storage URL when they are not. `releaseThumbnails` revokes either — calling
   * `revokeObjectURL` on an https URL is a no-op, so the caller need not care
   * which it got.
   */
  url: string;
  /** Video only: URL of the poster still, when the record has one. */
  posterUrl?: string;
  /** True while the upload to the account is still in flight. */
  pending?: boolean;
  /** True when the bytes are not in this browser yet. */
  remoteOnly?: boolean;
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

/**
 * Must be a real UUID, not just something unique: this id is the primary key of
 * the `media` row too, and Postgres will reject anything else. `randomUUID` is
 * missing outside secure contexts, so the fallback builds a v4 by hand rather
 * than falling back to a readable-but-invalid id.
 */
function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Records written before roles existed are artwork. */
function roleOf(record: MediaRecord): ImageRole {
  return record.role ?? 'artwork';
}

/** Records written before video existed are stills. */
function kindOf(record: MediaRecord): MediaKind {
  return record.kind === 'video' ? 'video' : 'image';
}

/** Records written before accounts existed belong to nobody until claimed. */
function ownerOf(record: MediaRecord): string {
  return record.userId ?? '';
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

/**
 * Normalises an upload and writes it to the local cache. It does **not** touch
 * the account — `library.addMedia` calls this first and uploads second, so the
 * picker can show the new tile immediately instead of after a 40 MB round trip.
 */
export async function addLocalMedia(
  file: File,
  role: ImageRole,
  userId: string,
): Promise<MediaRecord> {
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
  const existing = await listRecords(role, userId);
  if (existing.length >= limits.max) {
    throw new ImageError(`You can keep ${limits.max} ${role} files — delete one first.`);
  }

  const media = video
    ? { ...(await probeVideo(file)), blob: file as Blob }
    : { ...(await normalize(file, limits.maxEdge)), duration: 0, poster: undefined };

  const record: MediaRecord = {
    id: makeId(),
    userId,
    role,
    kind: video ? 'video' : 'image',
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 48) || role,
    blob: media.blob,
    mimeType: media.blob.type || (video ? 'video/mp4' : 'image/webp'),
    byteSize: media.blob.size,
    width: media.width,
    height: media.height,
    duration: media.duration,
    createdAt: Date.now(),
    poster: media.poster,
  };
  await putRecord(record);
  return record;
}

export async function getRecord(id: string): Promise<MediaRecord | null> {
  const record = await tx<MediaRecord | undefined>('readonly', (store) => store.get(id));
  return record ?? null;
}

export async function putRecord(record: MediaRecord): Promise<void> {
  await tx('readwrite', (store) => store.put(record));
}

/** Newest first, and only ever this account's. */
export async function listRecords(role: ImageRole, userId: string): Promise<MediaRecord[]> {
  const records = await tx<MediaRecord[]>('readonly', (store) => store.getAll());
  return records
    .filter((record) => roleOf(record) === role && ownerOf(record) === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function allRecordsFor(userId: string): Promise<MediaRecord[]> {
  const records = await tx<MediaRecord[]>('readonly', (store) => store.getAll());
  return records.filter((record) => ownerOf(record) === userId);
}

/**
 * Adopts anything left in this browser from before there were accounts, plus
 * anything a *previous* build wrote without an owner. Runs once per sign-in and
 * is a no-op afterwards, because the records it moves stop matching `''`.
 *
 * Whichever account signs in first gets them. That is the only answer available
 * — the records carry no hint of who made them — and it matches what the person
 * who uploaded them expects to see.
 */
export async function claimOrphans(userId: string): Promise<number> {
  const records = await tx<MediaRecord[]>('readonly', (store) => store.getAll());
  const orphans = records.filter((record) => !ownerOf(record));
  for (const orphan of orphans) {
    await putRecord({ ...orphan, userId });
  }
  return orphans.length;
}

/** Local delete only. `library.deleteMedia` removes the account copy too. */
export async function deleteRecord(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
  evictFromCache(id);
}

/**
 * Empties this browser's cache of one account's media. Called on sign-out: the
 * bytes are safe in the bucket, and leaving a stranger's uploads in IndexedDB
 * on a shared machine is not worth the download they save.
 */
export async function purgeUser(userId: string): Promise<void> {
  const records = await allRecordsFor(userId);
  for (const record of records) {
    await tx('readwrite', (store) => store.delete(record.id));
    evictFromCache(record.id);
  }
}

function evictFromCache(id: string): void {
  const cached = mediaCache.get(id);
  if (!cached) return;
  if (cached.media.element instanceof HTMLVideoElement) {
    cached.media.element.pause();
    cached.media.element.removeAttribute('src');
    cached.media.element.load();
  }
  URL.revokeObjectURL(cached.url);
  mediaCache.delete(id);
}

export function releaseThumbnails(items: MediaSummary[]): void {
  for (const item of items) {
    // Harmless on the signed https URLs a not-yet-downloaded record gets.
    URL.revokeObjectURL(item.url);
    if (item.posterUrl) URL.revokeObjectURL(item.posterUrl);
  }
}

/* ------------------------------------------------------------------ */
/* Fetching bytes this browser does not have                           */
/* ------------------------------------------------------------------ */

export type BlobResolver = (record: MediaRecord) => Promise<Blob | null>;

let resolveRemoteBlob: BlobResolver | null = null;

/**
 * Installed once by `library.ts`. This indirection is the seam that keeps the
 * cache free of any Supabase import — and it means a record with no bytes and
 * no resolver degrades to "missing", not to a crash.
 */
export function setBlobResolver(resolver: BlobResolver | null): void {
  resolveRemoteBlob = resolver;
}

const blobFetches = new Map<string, Promise<MediaRecord | null>>();

/**
 * The record with its bytes present, downloading them if this is the first time
 * this browser has needed them. Concurrent callers share one download — the
 * preview, the picker and an export can all ask for the same clip at once.
 */
export async function ensureBlob(record: MediaRecord): Promise<MediaRecord | null> {
  if (record.blob) return record;
  if (!record.storagePath || !resolveRemoteBlob) return null;

  const inFlightFetch = blobFetches.get(record.id);
  if (inFlightFetch) return inFlightFetch;

  const promise = (async () => {
    const blob = await resolveRemoteBlob!(record);
    if (!blob) return null;
    // Re-read before writing: the picker may have renamed or the sync may have
    // refreshed this row while the download was running.
    const current = (await getRecord(record.id)) ?? record;
    const filled: MediaRecord = { ...current, blob, byteSize: blob.size };
    await putRecord(filled);
    return filled;
  })().finally(() => blobFetches.delete(record.id));

  blobFetches.set(record.id, promise);
  return promise;
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
    const stored = await getRecord(id);
    if (!stored) return null;
    // Uploaded on another device? The bytes arrive here, once, on first use.
    const record = await ensureBlob(stored);
    if (!record?.blob) return null;
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
  const stored = await getRecord(id);
  if (!stored || kindOf(stored) !== 'video') return null;
  const record = await ensureBlob(stored);
  if (!record?.blob) return null;
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
