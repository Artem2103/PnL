/**
 * Sounds laid under a video: music, a voice-over. Kept in this browser's
 * IndexedDB, per account, the way the media library keeps its local copies.
 *
 * They are not uploaded to the account. The media table only knows photos and
 * clips, and a sound added here is for an export made here; a card opened on
 * another device simply has no track for it, and the studio says so.
 */

import { connection } from '../idb';

const DB_NAME = 'astra-sounds';
const STORE = 'sounds';
export const MAX_SOUND_BYTES = 40 * 1024 * 1024;
export const MAX_TRACKS = 10;

export interface SoundRecord {
  id: string;
  userId: string;
  name: string;
  /** Seconds. */
  duration: number;
  mimeType: string;
  blob: Blob;
  createdAt: number;
}

export type SoundSummary = Omit<SoundRecord, 'blob'>;

const { run } = connection({
  name: DB_NAME,
  store: STORE,
  create: (db) => db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('userId', 'userId'),
  openError: (cause) =>
    cause instanceof Error ? cause : new Error('This browser would not open its sound store.'),
});

/** Reads a file's length without decoding it: an `<audio>` element's metadata. */
function durationOf(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = 'metadata';
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      if (value === null) reject(new Error('That file is not a sound this browser can play.'));
      else resolve(value);
    };
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function addSound(userId: string, file: File): Promise<SoundSummary> {
  if (file.size > MAX_SOUND_BYTES) {
    throw new Error(`That sound is over ${Math.round(MAX_SOUND_BYTES / 1024 / 1024)} MB.`);
  }
  if (file.type && !file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
    throw new Error('That is not a sound file.');
  }
  const duration = await durationOf(file);
  const record: SoundRecord = {
    id: newId(),
    userId,
    name: file.name.replace(/\.[^.]+$/, '') || 'Sound',
    duration,
    mimeType: file.type || 'audio/mpeg',
    blob: file,
    createdAt: Date.now(),
  };
  await run('readwrite', (store) => store.put(record));
  const { blob: _blob, ...summary } = record;
  return summary;
}

export async function getSound(id: string): Promise<SoundRecord | null> {
  return (await run<SoundRecord | undefined>('readonly', (store) => store.get(id))) ?? null;
}

export async function listSounds(userId: string): Promise<SoundSummary[]> {
  const all = await run<SoundRecord[]>('readonly', (store) => store.index('userId').getAll(userId));
  return all
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ blob: _blob, ...summary }) => summary);
}

export async function deleteSound(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
}
