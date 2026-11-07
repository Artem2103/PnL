import { beforeEach, describe, expect, it } from 'vitest';
import { isNotInstalled, LocalCommunity } from './repository';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  clear() {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const post = (body: string) => ({ heading: '', body, images: [] });

describe('the local community', () => {
  let repo: LocalCommunity;

  beforeEach(async () => {
    storage.clear();
    repo = new LocalCommunity();
    await repo.ensureMember('b', 'Bea');
    await repo.ensureMember('a', 'Ana');
  });

  it('shows the newest first, and a repost as a new row of the old post', async () => {
    await repo.addPost('b', post('first'));
    const [first] = await repo.feed({});
    await repo.setRepost('a', first!.id, true);
    const feed = await repo.feed({});
    expect(feed).toHaveLength(2);
    expect(feed[0]).toMatchObject({ id: first!.id, repostedBy: 'ana', reposted: true, repostCount: 1 });
    await repo.setRepost('a', first!.id, false);
    expect(await repo.feed({})).toHaveLength(1);
  });

  it('filters by tag, follow and bookmark', async () => {
    await repo.addPost('b', post('long $EURUSD'));
    await repo.addPost('a', post('gm'));
    expect((await repo.feed({ tag: '$eurusd' })).map((p) => p.body)).toEqual(['long $EURUSD']);
    expect(await repo.feed({ tab: 'following' })).toEqual([]);
    await repo.setFollow('a', 'b', true);
    expect((await repo.feed({ tab: 'following' })).map((p) => p.body)).toEqual(['long $EURUSD']);
    const [top] = await repo.feed({});
    await repo.setBookmark('a', top!.id, true);
    expect(await repo.feed({ tab: 'bookmarks' })).toHaveLength(1);
  });

  it('keeps replies out of the feed, and under their post', async () => {
    await repo.addPost('b', post('first'));
    const [parent] = await repo.feed({});
    await repo.addPost('a', { ...post('nice'), replyTo: parent!.id });
    expect(await repo.feed({})).toHaveLength(1);
    expect((await repo.feed({ parentId: parent!.id })).map((p) => p.body)).toEqual(['nice']);
    expect((await repo.feed({}))[0]!.replyCount).toBe(1);
  });

  it('tells the owner, and not someone acting on their own post', async () => {
    await repo.addPost('a', post('mine'));
    const [own] = await repo.feed({});
    await repo.setLike('a', own!.id, true);
    expect(await repo.notifications()).toEqual([]);
    await repo.setLike('b', own!.id, true);
    expect(await repo.notifications()).toHaveLength(1);
  });

  it('refuses a handle someone has', async () => {
    await expect(repo.updateMember('a', { handle: 'bea' })).rejects.toThrow('taken');
  });
});

describe('a database without the community section', () => {
  it('is told apart from a real failure', () => {
    expect(isNotInstalled({ code: 'PGRST205' })).toBe(true);
    expect(isNotInstalled({ code: '42501' })).toBe(false);
  });
});
