/**
 * The media library as the app sees it: one account's artwork, avatars and
 * logos, wherever the bytes happen to be.
 *
 * `images.ts` is the browser-local cache and `remote/media.ts` is the account.
 * This file is the only place that knows both exist, and the only one the
 * components import.
 *
 * The shape of the thing is a **local-first mirror**:
 *
 *   upload    write to IndexedDB, show the tile, then push to the account
 *   list      read IndexedDB, sign URLs for whatever has not been downloaded
 *   open      read IndexedDB, download on the first miss, cache it
 *   delete    remove from the account, then locally
 *
 * The upload deliberately does not block the picker. A 40 MB clip takes as long
 * as it takes, and making the person watch a spinner before they can position
 * the background they just chose would be a worse app in exchange for a
 * simpler function. The cost is a window where the tile exists locally and not
 * in the account; `syncLibrary` closes it by retrying on the next sign-in.
 *
 * The rule that keeps that safe: **a local record with a `storagePath` has been
 * uploaded; one without has not.** Every reconciliation decision below reads
 * that flag, and nothing else.
 */

import {
  addLocalMedia,
  allRecordsFor,
  claimOrphans,
  deleteRecord,
  getRecord,
  listRecords,
  putRecord,
  setBlobResolver,
  type ImageRole,
  type MediaRecord,
  type MediaSummary,
} from './images';
import {
  deleteRemoteMedia,
  downloadMediaBlob,
  listRemoteMedia,
  signedUrlsFor,
  uploadMedia,
  type RemoteMedia,
} from './remote/media';
import { isSupabaseConfigured } from './supabase';

export { ImageError, acceptAttrFor, maxImagesFor, releaseThumbnails } from './images';
export type { ImageRole, MediaSummary } from './images';

/**
 * Teaches the cache how to fetch bytes it does not have. Installed once, at
 * module load, because `loadMedia` can be reached from the render loop long
 * before any component has mounted.
 */
setBlobResolver(async (record) => {
  if (!record.storagePath || !isSupabaseConfigured) return null;
  return downloadMediaBlob(record.storagePath);
});

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

export interface SyncReport {
  /** Manifest entries this browser had never seen. */
  added: number;
  /** Local uploads that had not reached the account, now pushed. */
  uploaded: number;
  /** Files deleted on another device, dropped from this cache. */
  removed: number;
  /** Pre-account uploads adopted into this account. */
  claimed: number;
}

/**
 * Reconciles this browser against the account. Safe to run repeatedly, and
 * cheap when nothing has changed: it is one query plus whatever genuinely
 * differs.
 *
 * Bytes are never downloaded here. A manifest entry becomes a metadata-only
 * record and stays that way until something actually draws it — otherwise
 * signing in on a phone would pull every clip in the library over cellular
 * before showing a single tile.
 */
export async function syncLibrary(userId: string): Promise<SyncReport> {
  const report: SyncReport = { added: 0, uploaded: 0, removed: 0, claimed: 0 };
  if (!isSupabaseConfigured || !userId) return report;

  // Anything uploaded before this browser had an account joins it now, so it
  // takes part in the same reconciliation as everything else.
  report.claimed = await claimOrphans(userId);

  const remote = await listRemoteMedia(userId);
  const remoteById = new Map<string, RemoteMedia>(remote.map((item) => [item.id, item]));
  const local = await allRecordsFor(userId);
  const localById = new Map<string, MediaRecord>(local.map((item) => [item.id, item]));

  for (const item of remote) {
    const existing = localById.get(item.id);
    if (!existing) {
      await putRecord(stubFrom(item));
      report.added += 1;
      continue;
    }
    // Known both sides: refresh the metadata, keep whatever bytes are cached.
    if (existing.storagePath !== item.storagePath || existing.posterPath !== item.posterPath) {
      await putRecord({
        ...existing,
        storagePath: item.storagePath,
        posterPath: item.posterPath ?? undefined,
      });
    }
  }

  for (const item of local) {
    if (remoteById.has(item.id)) continue;

    if (item.storagePath) {
      // It was uploaded once and the account no longer lists it — deleted from
      // another device. Follow suit rather than resurrecting it.
      await deleteRecord(item.id);
      report.removed += 1;
      continue;
    }

    // Never made it up: an upload that failed, or one interrupted by a closed
    // tab. Retry it now. One failure must not abort the whole sync, so this
    // swallows and moves on — the next sync tries again.
    if (item.blob) {
      try {
        await pushRecord(item);
        report.uploaded += 1;
      } catch (error) {
        console.warn(`Could not upload ${item.name}:`, error);
      }
    }
  }

  return report;
}

function stubFrom(item: RemoteMedia): MediaRecord {
  return {
    id: item.id,
    userId: item.userId,
    role: item.role,
    kind: item.kind,
    name: item.name,
    // No `blob` — that is what makes this a stub.
    mimeType: item.mimeType,
    byteSize: item.byteSize,
    width: item.width,
    height: item.height,
    duration: item.duration,
    createdAt: item.createdAt,
    storagePath: item.storagePath,
    posterPath: item.posterPath ?? undefined,
  };
}

async function pushRecord(record: MediaRecord): Promise<void> {
  const { storagePath, posterPath } = await uploadMedia(record);
  // Re-read first: the record may have been deleted while the bytes were in
  // flight, and writing it back here would resurrect it.
  const current = await getRecord(record.id);
  if (!current) return;
  await putRecord({ ...current, storagePath, posterPath: posterPath ?? undefined });
}

/* ------------------------------------------------------------------ */
/* The API the picker uses                                             */
/* ------------------------------------------------------------------ */

/**
 * One role's tiles. Records whose bytes are cached get object URLs; the rest
 * get signed Storage URLs, batched into a single request rather than one per
 * tile.
 */
export async function listMedia(role: ImageRole, userId: string): Promise<MediaSummary[]> {
  const records = await listRecords(role, userId);

  const needed: string[] = [];
  for (const record of records) {
    if (record.blob) continue;
    // A clip's poster is a few KB and its source is tens of MB — never sign the
    // clip when a poster exists.
    const path = record.kind === 'video' ? record.posterPath : record.storagePath;
    if (path) needed.push(path);
  }
  const signed = needed.length > 0 ? await signedUrlsFor(needed) : new Map<string, string>();

  return records.map((record) => {
    if (record.blob) {
      return {
        id: record.id,
        role: record.role,
        kind: record.kind,
        name: record.name,
        width: record.width,
        height: record.height,
        duration: record.duration ?? 0,
        createdAt: record.createdAt,
        url: URL.createObjectURL(record.blob),
        posterUrl: record.poster ? URL.createObjectURL(record.poster) : undefined,
        pending: !record.storagePath,
      };
    }

    const path = record.kind === 'video' ? record.posterPath : record.storagePath;
    const url = (path && signed.get(path)) || '';
    return {
      id: record.id,
      role: record.role,
      kind: record.kind,
      name: record.name,
      width: record.width,
      height: record.height,
      duration: record.duration ?? 0,
      createdAt: record.createdAt,
      url,
      // For a clip the signed URL *is* the poster; the tile must not try to
      // mount it as a `<video>`, which would stream the whole file.
      posterUrl: record.kind === 'video' ? url || undefined : undefined,
      remoteOnly: true,
    };
  });
}

/**
 * Adds a file: local first so the tile appears at once, then up to the account.
 * Resolves as soon as the local write lands — `onUploaded` fires later, and is
 * how the picker turns off the "saving" badge.
 */
export async function addMedia(
  file: File,
  role: ImageRole,
  userId: string,
  onUploaded?: (error?: Error) => void,
): Promise<MediaRecord> {
  const record = await addLocalMedia(file, role, userId);

  if (isSupabaseConfigured) {
    void pushRecord(record).then(
      () => onUploaded?.(),
      (error: unknown) =>
        onUploaded?.(
          error instanceof Error ? error : new Error('That file could not be saved to your account.'),
        ),
    );
  } else {
    onUploaded?.();
  }

  return record;
}

/**
 * Account first, cache second. The other order would leave a tile that has
 * visibly gone from this browser but comes back on the next sign-in — the most
 * confusing possible outcome of pressing delete.
 */
export async function deleteMedia(id: string, userId: string): Promise<void> {
  const record = await getRecord(id);
  if (record?.storagePath && isSupabaseConfigured) {
    await deleteRemoteMedia(userId, id, record.posterPath ?? null);
  }
  await deleteRecord(id);
}
