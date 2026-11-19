/**
 * Where the board comes from: two Supabase tables and a public "boards" bucket
 * (see the Boards section of `supabase/schema.sql`). Everyone can read; only an
 * account listed in `board_admins` can change anything, and the database — not
 * this file — is what enforces that.
 *
 * The image bytes live in storage. A position row holds only, per timeframe, the
 * path of the original screenshot, the path of its canvas thumbnail and the
 * original's pixel size.
 */

import { normalizeImage } from '../lib/images';
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase';
import { isNotInstalled } from '../community/repository';
import { TIMEFRAMES, type Category, type Frame, type Position, type Timeframe } from './model';

const BUCKET = 'boards';
/** Wide enough for a 380 px column on a 2× screen at a little over 1:1 zoom. */
export const THUMB_EDGE = 1000;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
export const BOARD_ACCEPT = ACCEPTED.join(',');

export interface StoredFrame {
  path: string;
  thumb: string;
  w: number;
  h: number;
  /** The chart link the picture was taken from (a TradingView snapshot), if any. */
  source?: string;
}

export interface RawPosition {
  id: string;
  categoryId: string;
  sort: number;
  frames: Partial<Record<Timeframe, StoredFrame>>;
  link: string | null;
}

export interface RawCategory {
  id: string;
  name: string;
  sort: number;
  positions: RawPosition[];
}

export type BoardSource =
  | { kind: 'remote'; raw: RawCategory[] }
  /** No Supabase, or the tables aren't there yet. */
  | { kind: 'unavailable'; reason: 'not-configured' | 'not-installed' };

function fail(what: string, error: { message: string; code?: string }): never {
  throw Object.assign(new Error(`${what}: ${error.message}`), { code: error.code });
}

function publicUrl(path: string): string {
  return requireSupabase().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function cleanFrames(value: unknown): RawPosition['frames'] {
  const frames: RawPosition['frames'] = {};
  if (!value || typeof value !== 'object') return frames;
  for (const tf of TIMEFRAMES) {
    const f = (value as Record<string, Partial<StoredFrame> | undefined>)[tf];
    if (f && typeof f.path === 'string' && typeof f.thumb === 'string' && Number(f.w) > 0 && Number(f.h) > 0) {
      const source = typeof f.source === 'string' ? cleanLink(f.source) : null;
      frames[tf] = { path: f.path, thumb: f.thumb, w: Number(f.w), h: Number(f.h), ...(source ? { source } : {}) };
    }
  }
  return frames;
}

export async function loadBoard(): Promise<BoardSource> {
  if (!isSupabaseConfigured) return { kind: 'unavailable', reason: 'not-configured' };
  const db = requireSupabase();
  const [cats, rows] = await Promise.all([
    db.from('board_categories').select('id, name, sort').order('sort').order('created_at'),
    db.from('board_positions').select('id, category_id, sort, frames, link').order('sort').order('created_at'),
  ]);
  const error = cats.error ?? rows.error;
  if (error) {
    if (isNotInstalled(error)) return { kind: 'unavailable', reason: 'not-installed' };
    fail('Could not load the board', error);
  }
  const raw: RawCategory[] = (cats.data ?? []).map((c) => ({ id: c.id, name: c.name, sort: c.sort, positions: [] }));
  const byId = new Map(raw.map((c) => [c.id, c]));
  for (const row of rows.data ?? []) {
    byId.get(row.category_id)?.positions.push({
      id: row.id,
      categoryId: row.category_id,
      sort: row.sort,
      frames: cleanFrames(row.frames),
      link: typeof row.link === 'string' && row.link ? row.link : null,
    });
  }
  return { kind: 'remote', raw };
}

/** What the canvas draws. Positions with no screenshot yet are left off. */
export function toBoard(raw: RawCategory[]): Category[] {
  return raw.map((c) => ({
    id: c.id,
    name: c.name,
    positions: c.positions
      .map((p): Position => {
        const frames: Position['frames'] = {};
        for (const tf of TIMEFRAMES) {
          const s = p.frames[tf];
          if (s) frames[tf] = { thumb: publicUrl(s.thumb), full: publicUrl(s.path), w: s.w, h: s.h } satisfies Frame;
        }
        return { id: p.id, categoryId: c.id, frames, link: p.link };
      })
      .filter((p) => Object.keys(p.frames).length > 0),
  }));
}

export function hasPositions(raw: RawCategory[]): boolean {
  return raw.some((c) => c.positions.some((p) => Object.keys(p.frames).length > 0));
}

export function thumbUrl(frame: StoredFrame): string {
  return publicUrl(frame.thumb);
}

/** Whether the signed-in account may manage the board. False on any doubt. */
export async function isBoardAdmin(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { data, error } = await requireSupabase().rpc('is_board_admin');
  return !error && data === true;
}

/* ------------------------------------------------------------------ admin */

const nextSort = (items: { sort: number }[]) => items.reduce((max, item) => Math.max(max, item.sort), 0) + 1;

export async function addCategory(name: string, existing: RawCategory[]): Promise<void> {
  const { error } = await requireSupabase().from('board_categories').insert({ name, sort: nextSort(existing) });
  if (error) fail('Could not add the category', error);
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const { error } = await requireSupabase().from('board_categories').update({ name }).eq('id', id);
  if (error) fail('Could not rename the category', error);
}

/** Swaps the order of two rows of the same table. */
export async function swapOrder(
  table: 'board_categories' | 'board_positions',
  a: { id: string; sort: number },
  b: { id: string; sort: number },
): Promise<void> {
  const db = requireSupabase();
  // Equal sorts (two rows added in the same instant) would swap to the same thing.
  const [sa, sb] = a.sort === b.sort ? [b.sort + 1, a.sort] : [b.sort, a.sort];
  const results = await Promise.all([
    db.from(table).update({ sort: sa }).eq('id', a.id),
    db.from(table).update({ sort: sb }).eq('id', b.id),
  ]);
  const error = results.find((r) => r.error)?.error;
  if (error) fail('Could not reorder', error);
}

function pathsOf(position: RawPosition): string[] {
  return Object.values(position.frames).flatMap((f) => (f ? [f.path, f.thumb] : []));
}

async function removeFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  // Best effort: an orphaned file costs storage, never correctness.
  await requireSupabase().storage.from(BUCKET).remove(paths);
}

export async function deleteCategory(category: RawCategory): Promise<void> {
  const { error } = await requireSupabase().from('board_categories').delete().eq('id', category.id);
  if (error) fail('Could not delete the category', error);
  await removeFiles(category.positions.flatMap(pathsOf));
}

export async function addPosition(category: RawCategory): Promise<string> {
  const { data, error } = await requireSupabase()
    .from('board_positions')
    .insert({ category_id: category.id, sort: nextSort(category.positions), frames: {} })
    .select('id')
    .single();
  if (error) fail('Could not add the position', error);
  return data.id as string;
}

/** Only http(s) links: anything else could run script when clicked. */
export function cleanLink(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export async function setLink(position: RawPosition, value: string): Promise<void> {
  const link = cleanLink(value);
  if (value.trim() && !link) throw new Error('That is not a web link. Paste the full https://t.me/… address.');
  const { error } = await requireSupabase().from('board_positions').update({ link }).eq('id', position.id);
  if (error) fail('Could not save the link', error);
}

export async function deletePosition(position: RawPosition): Promise<void> {
  const { error } = await requireSupabase().from('board_positions').delete().eq('id', position.id);
  if (error) fail('Could not delete the position', error);
  await removeFiles(pathsOf(position));
}

async function pixelSize(file: Blob): Promise<{ w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { w: bitmap.width, h: bitmap.height };
  bitmap.close();
  return size;
}

function extensionFor(type: string): string {
  return type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
}

/**
 * Puts a screenshot in a timeframe slot, replacing whatever was there. The
 * original is stored byte for byte; only the canvas copy is resized.
 */
export async function setFrame(position: RawPosition, tf: Timeframe, file: File, source?: string | null): Promise<void> {
  if (!ACCEPTED.includes(file.type)) throw new Error('Use a PNG, JPEG or WebP screenshot.');
  const db = requireSupabase();
  const { w, h } = await pixelSize(file);
  const thumb = await normalizeImage(file, THUMB_EDGE);
  const base = `${position.id}/${tf}-${Date.now().toString(36)}`;
  const link = source ? cleanLink(source) : null;
  const stored: StoredFrame = {
    path: `${base}.${extensionFor(file.type)}`,
    thumb: `${base}-thumb.webp`,
    w,
    h,
    ...(link ? { source: link } : {}),
  };

  const bucket = db.storage.from(BUCKET);
  const up = await Promise.all([
    bucket.upload(stored.path, file, { contentType: file.type, cacheControl: '31536000', upsert: false }),
    bucket.upload(stored.thumb, thumb.blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false }),
  ]);
  const upError = up.find((r) => r.error)?.error;
  if (upError) {
    await removeFiles([stored.path, stored.thumb]);
    fail('Could not upload the screenshot', upError);
  }

  const frames = { ...position.frames, [tf]: stored };
  const { error } = await db.from('board_positions').update({ frames }).eq('id', position.id);
  if (error) {
    await removeFiles([stored.path, stored.thumb]);
    fail('Could not save the screenshot', error);
  }
  const old = position.frames[tf];
  if (old) await removeFiles([old.path, old.thumb]);
}

export async function removeFrame(position: RawPosition, tf: Timeframe): Promise<void> {
  const old = position.frames[tf];
  if (!old) return;
  const frames = { ...position.frames };
  delete frames[tf];
  const { error } = await requireSupabase().from('board_positions').update({ frames }).eq('id', position.id);
  if (error) fail('Could not remove the screenshot', error);
  await removeFiles([old.path, old.thumb]);
}
