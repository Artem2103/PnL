/**
 * The community's data. The account's tables when Supabase is configured;
 * `localStorage` in local mode, where there is one person and no one to talk to,
 * so the page can still be worked on.
 */

import { isSupabaseConfigured, requireSupabase } from '../lib/supabase';
import { handleFrom, tagsIn } from './text';

export interface Member {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarPath: string | null;
  bannerPath: string | null;
  createdAt: string;
}

export interface MemberStats {
  posts: number;
  followers: number;
  following: number;
  /** Whether the viewer follows them. */
  followed: boolean;
}

export interface FeedPost {
  /** The row in the feed: the post, or someone's repost of it. */
  entryId: string;
  entryAt: string;
  repostedBy: string | null;
  id: string;
  userId: string;
  heading: string;
  body: string;
  images: string[];
  replyTo: string | null;
  createdAt: string;
  handle: string;
  displayName: string;
  avatarPath: string | null;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
  following: boolean;
}

export interface FeedQuery {
  tab?: 'foryou' | 'following' | 'bookmarks';
  tag?: string;
  query?: string;
  authorId?: string;
  parentId?: string;
  before?: string;
}

export interface PostInput {
  heading: string;
  body: string;
  images: string[];
  replyTo?: string;
}

export interface Notice {
  id: string;
  kind: 'like' | 'reply' | 'repost' | 'follow';
  postId: string | null;
  createdAt: string;
  read: boolean;
  actorHandle: string;
  actorName: string;
  actorAvatar: string | null;
}

export type ReportReason = 'spam' | 'scam' | 'abuse' | 'other';

export interface CommunityRepository {
  /** The viewer's member row, made on first visit. */
  ensureMember(userId: string, name: string): Promise<Member>;
  member(handle: string): Promise<Member | null>;
  stats(memberId: string, viewerId: string | null): Promise<MemberStats>;
  updateMember(id: string, patch: Partial<Pick<Member, 'handle' | 'displayName' | 'bio' | 'avatarPath' | 'bannerPath'>>): Promise<Member>;
  feed(query: FeedQuery): Promise<FeedPost[]>;
  addPost(userId: string, input: PostInput): Promise<void>;
  deletePost(id: string): Promise<void>;
  setLike(userId: string, postId: string, on: boolean): Promise<void>;
  setRepost(userId: string, postId: string, on: boolean): Promise<void>;
  setBookmark(userId: string, postId: string, on: boolean): Promise<void>;
  setFollow(userId: string, memberId: string, on: boolean): Promise<void>;
  report(userId: string, postId: string, reason: ReportReason): Promise<void>;
  suggestions(viewerId: string | null): Promise<Member[]>;
  trending(): Promise<{ tag: string; uses: number }[]>;
  notifications(userId: string): Promise<Notice[]>;
  markRead(userId: string): Promise<void>;
  /** Stores a re-encoded picture and returns its path. */
  upload(userId: string, blob: Blob): Promise<string>;
  /** Removes a stored picture. Best effort: a leftover file is harmless. */
  removeFile(path: string): Promise<void>;
}

const BUCKET = 'community';

export function imageUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('data:')) return path;
  return isSupabaseConfigured ? requireSupabase().storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
}

/** The tables are missing: `supabase/schema.sql` has not been run. */
export function isNotInstalled(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883';
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function fail(what: string, error: { message: string; code?: string }): never {
  throw Object.assign(new Error(`${what}: ${error.message}`), { code: error.code });
}

/* ------------------------------------------------------------------ */
/* Supabase                                                            */
/* ------------------------------------------------------------------ */

interface MemberRow {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_path: string | null;
  banner_path: string | null;
  created_at: string;
}

interface FeedRow {
  entry_id: string;
  entry_at: string;
  reposted_by: string | null;
  id: string;
  user_id: string;
  heading: string;
  body: string;
  images: string[];
  reply_to: string | null;
  created_at: string;
  handle: string;
  display_name: string;
  avatar_path: string | null;
  like_count: number;
  reply_count: number;
  repost_count: number;
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
  following: boolean;
}

const MEMBER_COLUMNS = 'id, handle, display_name, bio, avatar_path, banner_path, created_at';

function fromMember(row: MemberRow): Member {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarPath: row.avatar_path,
    bannerPath: row.banner_path,
    createdAt: row.created_at,
  };
}

function fromFeed(row: FeedRow): FeedPost {
  return {
    entryId: row.entry_id,
    entryAt: row.entry_at,
    repostedBy: row.reposted_by,
    id: row.id,
    userId: row.user_id,
    heading: row.heading,
    body: row.body,
    images: row.images,
    replyTo: row.reply_to,
    createdAt: row.created_at,
    handle: row.handle,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    likeCount: Number(row.like_count),
    replyCount: Number(row.reply_count),
    repostCount: Number(row.repost_count),
    liked: row.liked,
    reposted: row.reposted,
    bookmarked: row.bookmarked,
    following: row.following,
  };
}

export class SupabaseCommunity implements CommunityRepository {
  private get db() {
    return requireSupabase();
  }

  async ensureMember(userId: string, name: string): Promise<Member> {
    const { data, error } = await this.db.from('community_profiles').select(MEMBER_COLUMNS).eq('id', userId).maybeSingle();
    if (error) fail('Could not open your profile', error);
    if (data) return fromMember(data as MemberRow);
    // Unique violation means the handle is taken; the id-based one is not.
    for (const handle of [handleFrom(name, userId), `trader${userId.replace(/-/g, '').slice(0, 8)}`]) {
      const inserted = await this.db
        .from('community_profiles')
        .insert({ id: userId, handle, display_name: name.slice(0, 50) })
        .select(MEMBER_COLUMNS)
        .single();
      if (!inserted.error) return fromMember(inserted.data as MemberRow);
      if (inserted.error.code !== '23505') fail('Could not create your profile', inserted.error);
    }
    throw new Error('Could not create your profile.');
  }

  async member(handle: string): Promise<Member | null> {
    const { data, error } = await this.db
      .from('community_profiles')
      .select(MEMBER_COLUMNS)
      .eq('handle', handle.toLowerCase())
      .maybeSingle();
    if (error) fail('Could not load that profile', error);
    return data ? fromMember(data as MemberRow) : null;
  }

  async stats(memberId: string, viewerId: string | null): Promise<MemberStats> {
    const count = async (table: string, column: string) => {
      const { count: total, error } = await this.db.from(table).select('*', { count: 'exact', head: true }).eq(column, memberId);
      if (error) fail('Could not load that profile', error);
      return total ?? 0;
    };
    const [posts, followers, following] = await Promise.all([
      count('posts', 'user_id'),
      count('follows', 'followee_id'),
      count('follows', 'follower_id'),
    ]);
    let followed = false;
    if (viewerId && viewerId !== memberId) {
      const { data } = await this.db
        .from('follows')
        .select('followee_id')
        .eq('follower_id', viewerId)
        .eq('followee_id', memberId)
        .maybeSingle();
      followed = Boolean(data);
    }
    return { posts, followers, following, followed };
  }

  async updateMember(id: string, patch: Parameters<CommunityRepository['updateMember']>[1]): Promise<Member> {
    const row: Record<string, unknown> = {};
    if (patch.handle !== undefined) row.handle = patch.handle;
    if (patch.displayName !== undefined) row.display_name = patch.displayName;
    if (patch.bio !== undefined) row.bio = patch.bio;
    if (patch.avatarPath !== undefined) row.avatar_path = patch.avatarPath;
    if (patch.bannerPath !== undefined) row.banner_path = patch.bannerPath;
    const { data, error } = await this.db.from('community_profiles').update(row).eq('id', id).select(MEMBER_COLUMNS).single();
    if (error) {
      if (error.code === '23505') throw new Error('That handle is taken.');
      fail('Could not save your profile', error);
    }
    return fromMember(data as MemberRow);
  }

  async feed(query: FeedQuery): Promise<FeedPost[]> {
    const { data, error } = await this.db.rpc('community_feed', {
      p_tab: query.tab ?? 'foryou',
      p_tag: query.tag ?? null,
      p_query: query.query || null,
      p_author: query.authorId ?? null,
      p_parent: query.parentId ?? null,
      p_before: query.before ?? null,
      p_limit: 30,
    });
    if (error) fail('Could not load the feed', error);
    return (data as FeedRow[]).map(fromFeed);
  }

  async addPost(userId: string, input: PostInput): Promise<void> {
    const { error } = await this.db.from('posts').insert({
      user_id: userId,
      heading: input.heading,
      body: input.body,
      images: input.images,
      reply_to: input.replyTo ?? null,
    });
    if (error) fail('Could not publish that', error);
  }

  async deletePost(id: string): Promise<void> {
    const { error } = await this.db.from('posts').delete().eq('id', id);
    if (error) fail('Could not delete that post', error);
  }

  private async toggle(table: string, row: Record<string, string>, on: boolean) {
    if (on) {
      const { error } = await this.db.from(table).upsert(row, { ignoreDuplicates: true });
      if (error) fail('That did not save', error);
      return;
    }
    let remove = this.db.from(table).delete();
    for (const [key, value] of Object.entries(row)) remove = remove.eq(key, value);
    const { error } = await remove;
    if (error) fail('That did not save', error);
  }

  setLike(userId: string, postId: string, on: boolean) {
    return this.toggle('post_likes', { user_id: userId, post_id: postId }, on);
  }

  setBookmark(userId: string, postId: string, on: boolean) {
    return this.toggle('post_bookmarks', { user_id: userId, post_id: postId }, on);
  }

  setFollow(userId: string, memberId: string, on: boolean) {
    return this.toggle('follows', { follower_id: userId, followee_id: memberId }, on);
  }

  async setRepost(userId: string, postId: string, on: boolean): Promise<void> {
    if (on) {
      const { error } = await this.db.from('posts').insert({ user_id: userId, repost_of: postId });
      if (error && error.code !== '23505') fail('Could not repost that', error);
      return;
    }
    const { error } = await this.db.from('posts').delete().eq('user_id', userId).eq('repost_of', postId);
    if (error) fail('Could not undo that repost', error);
  }

  async report(userId: string, postId: string, reason: ReportReason): Promise<void> {
    const { error } = await this.db.from('post_reports').insert({ reporter_id: userId, post_id: postId, reason });
    // Reporting the same post twice is still "reported".
    if (error && error.code !== '23505') fail('Could not send that report', error);
  }

  async suggestions(viewerId: string | null): Promise<Member[]> {
    const { data, error } = await this.db
      .from('community_profiles')
      .select(MEMBER_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(12);
    if (error) fail('Could not load suggestions', error);
    let members = (data as MemberRow[]).map(fromMember).filter((m) => m.id !== viewerId);
    if (viewerId) {
      const followed = await this.db.from('follows').select('followee_id').eq('follower_id', viewerId);
      const ids = new Set((followed.data ?? []).map((row: { followee_id: string }) => row.followee_id));
      members = members.filter((m) => !ids.has(m.id));
    }
    return members.slice(0, 4);
  }

  async trending(): Promise<{ tag: string; uses: number }[]> {
    const { data, error } = await this.db.rpc('community_trending');
    if (error) fail('Could not load what is trending', error);
    return (data as { tag: string; uses: number }[]).map((row) => ({ tag: row.tag, uses: Number(row.uses) }));
  }

  async notifications(userId: string): Promise<Notice[]> {
    const { data, error } = await this.db
      .from('notifications')
      .select('id, kind, post_id, created_at, read_at, actor_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) fail('Could not load your notifications', error);
    const rows = data as { id: string; kind: Notice['kind']; post_id: string | null; created_at: string; read_at: string | null; actor_id: string }[];
    const actors = [...new Set(rows.map((row) => row.actor_id))];
    const members = actors.length
      ? await this.db.from('community_profiles').select(MEMBER_COLUMNS).in('id', actors)
      : { data: [] };
    const byId = new Map(((members.data ?? []) as MemberRow[]).map((row) => [row.id, row]));
    return rows.flatMap((row) => {
      const actor = byId.get(row.actor_id);
      if (!actor) return [];
      return [{
        id: row.id,
        kind: row.kind,
        postId: row.post_id,
        createdAt: row.created_at,
        read: row.read_at !== null,
        actorHandle: actor.handle,
        actorName: actor.display_name,
        actorAvatar: actor.avatar_path,
      }];
    });
  }

  async markRead(userId: string): Promise<void> {
    const { error } = await this.db
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) fail('Could not update your notifications', error);
  }

  async upload(userId: string, blob: Blob): Promise<string> {
    const path = `${userId}/${newId()}.webp`;
    const { error } = await this.db.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type || 'image/webp',
      cacheControl: '31536000',
    });
    if (error) throw new Error(`That picture could not be uploaded: ${error.message}`);
    return path;
  }

  async removeFile(path: string): Promise<void> {
    await this.db.storage.from(BUCKET).remove([path]);
  }
}

/* ------------------------------------------------------------------ */
/* localStorage                                                        */
/* ------------------------------------------------------------------ */

interface LocalPost {
  id: string;
  userId: string;
  heading: string;
  body: string;
  images: string[];
  replyTo: string | null;
  repostOf: string | null;
  createdAt: string;
}

interface LocalData {
  members: Member[];
  posts: LocalPost[];
  likes: string[];
  bookmarks: string[];
  /** "follower>followee" */
  follows: string[];
  notices: Notice[];
}

const LOCAL_KEY = 'astra:community:v1';

export class LocalCommunity implements CommunityRepository {
  private read(): LocalData {
    const empty: LocalData = { members: [], posts: [], likes: [], bookmarks: [], follows: [], notices: [] };
    try {
      return { ...empty, ...(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Partial<LocalData>) };
    } catch {
      return empty;
    }
  }

  private write(data: LocalData): void {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    } catch {
      throw new Error('This browser would not save that — its storage is full or blocked.');
    }
  }

  private viewer = 'local';

  async ensureMember(userId: string, name: string): Promise<Member> {
    this.viewer = userId;
    const data = this.read();
    const found = data.members.find((m) => m.id === userId);
    if (found) return found;
    const member: Member = {
      id: userId,
      handle: handleFrom(name, 'you0'),
      displayName: name,
      bio: '',
      avatarPath: null,
      bannerPath: null,
      createdAt: new Date().toISOString(),
    };
    data.members.push(member);
    this.write(data);
    return member;
  }

  async member(handle: string): Promise<Member | null> {
    return this.read().members.find((m) => m.handle === handle.toLowerCase()) ?? null;
  }

  async stats(memberId: string, viewerId: string | null): Promise<MemberStats> {
    const data = this.read();
    return {
      posts: data.posts.filter((p) => p.userId === memberId).length,
      followers: data.follows.filter((f) => f.endsWith(`>${memberId}`)).length,
      following: data.follows.filter((f) => f.startsWith(`${memberId}>`)).length,
      followed: data.follows.includes(`${viewerId}>${memberId}`),
    };
  }

  async updateMember(id: string, patch: Parameters<CommunityRepository['updateMember']>[1]): Promise<Member> {
    const data = this.read();
    if (patch.handle && data.members.some((m) => m.handle === patch.handle && m.id !== id)) {
      throw new Error('That handle is taken.');
    }
    const member = data.members.find((m) => m.id === id);
    if (!member) throw new Error('That profile is gone.');
    Object.assign(member, patch);
    this.write(data);
    return member;
  }

  async feed(query: FeedQuery): Promise<FeedPost[]> {
    const data = this.read();
    const viewer = this.viewer;
    const needle = query.query?.toLowerCase();
    const rows: FeedPost[] = [];
    for (const entry of [...data.posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const post = entry.repostOf ? data.posts.find((p) => p.id === entry.repostOf) : entry;
      const author = post && data.members.find((m) => m.id === post.userId);
      if (!post || !author) continue;
      if (query.before && entry.createdAt >= query.before) continue;
      if (query.parentId ? entry.replyTo !== query.parentId : entry.replyTo) continue;
      if (query.authorId && entry.userId !== query.authorId) continue;
      if (query.tag && !tagsIn(post.body).includes(query.tag.toLowerCase())) continue;
      if (needle && !`${post.heading} ${post.body} ${author.handle}`.toLowerCase().includes(needle)) continue;
      if (query.tab === 'following' && !data.follows.includes(`${viewer}>${entry.userId}`)) continue;
      if (query.tab === 'bookmarks' && (entry.repostOf || !data.bookmarks.includes(`${viewer}>${post.id}`))) continue;
      rows.push({
        entryId: entry.id,
        entryAt: entry.createdAt,
        repostedBy: entry.repostOf ? (data.members.find((m) => m.id === entry.userId)?.handle ?? null) : null,
        id: post.id,
        userId: post.userId,
        heading: post.heading,
        body: post.body,
        images: post.images,
        replyTo: post.replyTo,
        createdAt: post.createdAt,
        handle: author.handle,
        displayName: author.displayName,
        avatarPath: author.avatarPath,
        likeCount: data.likes.filter((l) => l.endsWith(`>${post.id}`)).length,
        replyCount: data.posts.filter((p) => p.replyTo === post.id).length,
        repostCount: data.posts.filter((p) => p.repostOf === post.id).length,
        liked: data.likes.includes(`${viewer}>${post.id}`),
        reposted: data.posts.some((p) => p.repostOf === post.id && p.userId === viewer),
        bookmarked: data.bookmarks.includes(`${viewer}>${post.id}`),
        following: data.follows.includes(`${viewer}>${post.userId}`),
      });
      if (rows.length >= 30) break;
    }
    return rows;
  }

  private notify(data: LocalData, ownerId: string | undefined, actorId: string, kind: Notice['kind'], postId: string | null) {
    const actor = data.members.find((m) => m.id === actorId);
    // One person here, so only what is theirs counts.
    if (ownerId !== this.viewer || ownerId === actorId || !actor) return;
    data.notices.unshift({
      id: newId(),
      kind,
      postId,
      createdAt: new Date().toISOString(),
      read: false,
      actorHandle: actor.handle,
      actorName: actor.displayName,
      actorAvatar: actor.avatarPath,
    });
  }

  async addPost(userId: string, input: PostInput): Promise<void> {
    const data = this.read();
    data.posts.push({
      id: newId(),
      userId,
      heading: input.heading,
      body: input.body,
      images: input.images,
      replyTo: input.replyTo ?? null,
      repostOf: null,
      createdAt: new Date().toISOString(),
    });
    if (input.replyTo) this.notify(data, data.posts.find((p) => p.id === input.replyTo)?.userId, userId, 'reply', input.replyTo);
    this.write(data);
  }

  async deletePost(id: string): Promise<void> {
    const data = this.read();
    data.posts = data.posts.filter((p) => p.id !== id && p.replyTo !== id && p.repostOf !== id);
    this.write(data);
  }

  private flip(list: string[], key: string, on: boolean): string[] {
    const rest = list.filter((item) => item !== key);
    return on ? [...rest, key] : rest;
  }

  async setLike(userId: string, postId: string, on: boolean): Promise<void> {
    const data = this.read();
    data.likes = this.flip(data.likes, `${userId}>${postId}`, on);
    if (on) this.notify(data, data.posts.find((p) => p.id === postId)?.userId, userId, 'like', postId);
    this.write(data);
  }

  async setBookmark(userId: string, postId: string, on: boolean): Promise<void> {
    const data = this.read();
    data.bookmarks = this.flip(data.bookmarks, `${userId}>${postId}`, on);
    this.write(data);
  }

  async setFollow(userId: string, memberId: string, on: boolean): Promise<void> {
    const data = this.read();
    data.follows = this.flip(data.follows, `${userId}>${memberId}`, on);
    if (on) this.notify(data, memberId, userId, 'follow', null);
    this.write(data);
  }

  async setRepost(userId: string, postId: string, on: boolean): Promise<void> {
    const data = this.read();
    data.posts = data.posts.filter((p) => !(p.repostOf === postId && p.userId === userId));
    if (on) {
      data.posts.push({ id: newId(), userId, heading: '', body: '', images: [], replyTo: null, repostOf: postId, createdAt: new Date().toISOString() });
      this.notify(data, data.posts.find((p) => p.id === postId)?.userId, userId, 'repost', postId);
    }
    this.write(data);
  }

  async report(): Promise<void> {
    /* Nobody to tell in local mode. */
  }

  async suggestions(viewerId: string | null): Promise<Member[]> {
    const data = this.read();
    return data.members.filter((m) => m.id !== viewerId && !data.follows.includes(`${viewerId}>${m.id}`)).slice(0, 4);
  }

  async trending(): Promise<{ tag: string; uses: number }[]> {
    const counts = new Map<string, number>();
    for (const post of this.read().posts) for (const tag of tagsIn(post.body)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].map(([tag, uses]) => ({ tag, uses })).sort((a, b) => b.uses - a.uses).slice(0, 10);
  }

  async notifications(): Promise<Notice[]> {
    return this.read().notices;
  }

  async markRead(): Promise<void> {
    const data = this.read();
    for (const notice of data.notices) notice.read = true;
    this.write(data);
  }

  async upload(_userId: string, blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('That picture could not be read.'));
      reader.readAsDataURL(blob);
    });
  }

  async removeFile(): Promise<void> {
    /* The picture lived inside the row. */
  }
}

let shared: CommunityRepository | null = null;

export function community(): CommunityRepository {
  shared ??= isSupabaseConfigured ? new SupabaseCommunity() : new LocalCommunity();
  return shared;
}
