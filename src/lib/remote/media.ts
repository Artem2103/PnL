/**
 * The account's copy of the media library: rows in `public.media`, bytes in the
 * private `media` storage bucket.
 *
 * Every path is `<user_id>/<media_id>`, which is not a convention but the
 * security model — the storage policies in `supabase/schema.sql` match on that
 * first segment to decide who may read an object. Changing the layout here
 * without changing those policies would quietly open the bucket up.
 *
 * Ordering matters in both directions and is the same rule each time: **bytes
 * before rows on the way in, rows after bytes on the way out.** A row is a
 * promise that the object exists, so it is written last on upload and deleted
 * last on removal. The failure mode that leaves is an orphaned object with no
 * row — invisible, costs storage — which is strictly better than a row pointing
 * at nothing, which the picker would render as a broken tile forever.
 */

import type { ImageRole, MediaKind, MediaRecord } from '../images';
import { requireSupabase } from '../supabase';

const BUCKET = 'media';

/** How long a thumbnail URL stays good. Long enough to browse, short enough
 *  that a copied link is not a lasting hole in a private bucket. */
const SIGNED_URL_SECONDS = 60 * 60;

export interface RemoteMedia {
  id: string;
  userId: string;
  role: ImageRole;
  kind: MediaKind;
  name: string;
  width: number;
  height: number;
  duration: number;
  byteSize: number;
  mimeType: string;
  storagePath: string;
  posterPath: string | null;
  createdAt: number;
}

interface MediaRow {
  id: string;
  user_id: string;
  role: string;
  kind: string;
  name: string;
  width: number;
  height: number;
  duration: number;
  byte_size: number;
  mime_type: string;
  storage_path: string;
  poster_path: string | null;
  created_at: string;
}

function fromRow(row: MediaRow): RemoteMedia {
  return {
    id: row.id,
    userId: row.user_id,
    role: (row.role === 'avatar' || row.role === 'logo' ? row.role : 'artwork') as ImageRole,
    kind: row.kind === 'video' ? 'video' : 'image',
    name: row.name,
    width: row.width,
    height: row.height,
    duration: row.duration,
    byteSize: row.byte_size,
    mimeType: row.mime_type,
    storagePath: row.storage_path,
    posterPath: row.poster_path,
    createdAt: Date.parse(row.created_at) || Date.now(),
  };
}

export function objectPath(userId: string, id: string): string {
  return `${userId}/${id}`;
}

export function posterObjectPath(userId: string, id: string): string {
  return `${userId}/${id}.poster`;
}

/** Every file the account owns, newest first. This is the manifest a second
 *  device syncs from. */
export async function listRemoteMedia(userId: string): Promise<RemoteMedia[]> {
  const { data, error } = await requireSupabase()
    .from('media')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not read your media library: ${error.message}`);
  return (data as MediaRow[]).map(fromRow);
}

/**
 * Pushes one local record to the account. Returns the paths to store back on
 * the local record so a later sync recognises it as already uploaded.
 */
export async function uploadMedia(
  record: MediaRecord,
): Promise<{ storagePath: string; posterPath: string | null }> {
  if (!record.blob) throw new Error('That file has no data to upload.');
  const client = requireSupabase();
  const storagePath = objectPath(record.userId, record.id);
  const posterPath = record.poster ? posterObjectPath(record.userId, record.id) : null;

  const { error: uploadError } = await client.storage
    .from(BUCKET)
    .upload(storagePath, record.blob, {
      contentType: record.mimeType || 'application/octet-stream',
      // A retried upload after a half-failed attempt would otherwise collide
      // with the object it is trying to replace.
      upsert: true,
    });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  if (posterPath && record.poster) {
    const { error: posterError } = await client.storage
      .from(BUCKET)
      .upload(posterPath, record.poster, { contentType: 'image/webp', upsert: true });
    // A missing poster costs a thumbnail, not the file. Not worth failing over.
    if (posterError) console.warn('Poster upload failed:', posterError.message);
  }

  const { error: rowError } = await client.from('media').upsert({
    id: record.id,
    user_id: record.userId,
    role: record.role,
    kind: record.kind,
    name: record.name,
    width: record.width,
    height: record.height,
    duration: record.duration,
    byte_size: record.byteSize,
    mime_type: record.mimeType,
    storage_path: storagePath,
    poster_path: posterPath,
  });
  if (rowError) throw new Error(`Could not save that file to your account: ${rowError.message}`);

  return { storagePath, posterPath };
}

/** The bytes behind a manifest entry. Null when the object has gone missing. */
export async function downloadMediaBlob(storagePath: string): Promise<Blob | null> {
  const { data, error } = await requireSupabase().storage.from(BUCKET).download(storagePath);
  if (error || !data) return null;
  return data;
}

/**
 * A temporary URL for a thumbnail. The bucket is private, so this is the only
 * way to put a remote file in an `<img src>`.
 */
export async function signedUrlFor(storagePath: string): Promise<string | null> {
  const { data, error } = await requireSupabase()
    .storage.from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Signs a batch in one request rather than one round trip per tile. */
export async function signedUrlsFor(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await requireSupabase()
    .storage.from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error || !data) return out;
  for (const entry of data) {
    if (entry.signedUrl && entry.path) out.set(entry.path, entry.signedUrl);
  }
  return out;
}

/** Bytes first, row last — see the note at the top of this file. */
export async function deleteRemoteMedia(
  userId: string,
  id: string,
  posterPath?: string | null,
): Promise<void> {
  const client = requireSupabase();
  const paths = [objectPath(userId, id)];
  if (posterPath) paths.push(posterPath);

  const { error: objectError } = await client.storage.from(BUCKET).remove(paths);
  // Removing an object that is already gone is a success we do not need to
  // distinguish; only a real failure should stop the row from going too.
  if (objectError) throw new Error(`Could not delete that file: ${objectError.message}`);

  const { error: rowError } = await client.from('media').delete().eq('id', id);
  if (rowError) throw new Error(`Could not delete that file: ${rowError.message}`);
}
