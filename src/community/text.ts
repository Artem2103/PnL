/** The pure rules of the feed: what a post's text means, and what a handle may be. */

export const MAX_BODY = 2000;
export const MAX_HEADING = 80;
export const MAX_NAME = 50;
export const MAX_BIO = 160;
export const MAX_IMAGES = 4;

const HANDLE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set(['admin', 'astra', 'support', 'help', 'official', 'moderator', 'staff', 'community', 'everyone']);

export function isValidHandle(handle: string): boolean {
  return HANDLE.test(handle) && !RESERVED.has(handle);
}

/**
 * A first handle. Built from the name someone chose, never from their email:
 * handles are public, and the part before the @ is often a real name.
 */
export function handleFrom(name: string, seed: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '')
    .slice(0, 14);
  const suffix = seed.replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase();
  const candidate = base.length >= 3 ? base : `trader${suffix}`;
  return isValidHandle(candidate) ? candidate : `trader${suffix}`;
}

export function canPublish(body: string, imageCount: number): boolean {
  const length = body.trim().length;
  return length <= MAX_BODY && (length > 0 || imageCount > 0);
}

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; text: string; tag: string }
  | { kind: 'mention'; text: string; handle: string };

/** Same shape as the trigger in `schema.sql`, so what looks like a tag is one. */
const TOKEN = /(^|\s)([#$][A-Za-z][A-Za-z0-9_]{0,29}|@[A-Za-z0-9_]{3,20})/g;

/** Splits a post's text so tags and mentions can be links. Plain strings only: nothing here is ever HTML. */
export function tokenize(body: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  for (const match of body.matchAll(TOKEN)) {
    const start = match.index + match[1]!.length;
    if (start > at) tokens.push({ kind: 'text', text: body.slice(at, start) });
    const text = match[2]!;
    tokens.push(
      text.startsWith('@')
        ? { kind: 'mention', text, handle: text.slice(1).toLowerCase() }
        : { kind: 'tag', text, tag: text.toLowerCase() },
    );
    at = start + text.length;
  }
  if (at < body.length) tokens.push({ kind: 'text', text: body.slice(at) });
  return tokens;
}

export function tagsIn(body: string): string[] {
  const tags = new Set<string>();
  for (const token of tokenize(body)) if (token.kind === 'tag') tags.add(token.tag);
  return [...tags];
}

/** "now", "5m", "3h", "2d", then the date. */
export function timeAgo(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
