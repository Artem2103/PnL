import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProfileMenu } from '../components/ProfileMenu';
import { ThemeMenu } from '../components/ThemeMenu';
import { SiteNav } from '../components/SiteNav';
import { useAuth } from '../lib/auth';
import { ACCEPT_ATTR, normalizeImage } from '../lib/images';
import { HOME_PATH, PRICING_PATH, STUDIO_PATH, navigate, setAfterSignIn, useLocation } from '../lib/route';
import { Composer } from './Composer';
import { BellIcon, BookmarkIcon, CardIcon, CloseIcon, CompassIcon, HomeIcon, PlusIcon, SearchIcon, UserIcon } from './icons';
import { takePendingImage } from './pending';
import { PostItem } from './Post';
import {
  community,
  imageUrl,
  isNotInstalled,
  type FeedPost,
  type FeedQuery,
  type Member,
  type MemberStats,
  type Notice,
} from './repository';
import { Avatar, type Community } from './shared';
import { isValidHandle, MAX_BIO, MAX_NAME, timeAgo } from './text';
import { PLANS_ENABLED } from '../lib/billing';
import '../styles/community.css';

/**
 * Hidden for launch, not removed: `VITE_JOURNAL=on` puts a Journal button on your
 * own profile, and that opens the trades, the calendar and the share sheet.
 */
const JOURNAL_ENABLED = import.meta.env.VITE_JOURNAL === 'on';
const JournalModal = lazy(() =>
  import('../journal/ui/JournalModal').then((module) => ({ default: module.JournalModal })),
);

type View =
  | { kind: 'home' }
  | { kind: 'explore' }
  | { kind: 'notifications' }
  | { kind: 'bookmarks' }
  | { kind: 'tag'; tag: string }
  | { kind: 'member'; handle: string | null };

function viewFor(pathname: string, search: string): View {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/profile') return { kind: 'member', handle: null };
  if (path.startsWith('/u/')) return { kind: 'member', handle: decodeURIComponent(path.slice(3)).toLowerCase() };
  if (path === '/community/explore') return { kind: 'explore' };
  if (path === '/community/notifications') return { kind: 'notifications' };
  if (path === '/community/bookmarks') return { kind: 'bookmarks' };
  const tag = new URLSearchParams(search).get('tag');
  return tag ? { kind: 'tag', tag: tag.toLowerCase() } : { kind: 'home' };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That did not work.');

/* ------------------------------------------------------------------ */
/* The feed                                                            */
/* ------------------------------------------------------------------ */

function Feed({ app, query, now, empty, version }: { app: Community; query: FeedQuery; now: number; empty: string; version: number }) {
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [more, setMore] = useState(false);
  const key = JSON.stringify(query);

  useEffect(() => {
    let cancelled = false;
    setPosts(null);
    app.repo.feed(query).then(
      (rows) => {
        if (cancelled) return;
        setPosts(rows);
        setMore(rows.length >= 30);
      },
      (error: unknown) => {
        if (cancelled) return;
        setPosts([]);
        app.fail(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, version, app.repo, app.me?.id]);

  const loadMore = async () => {
    const before = posts?.[posts.length - 1]?.entryAt;
    if (!before) return;
    try {
      const rows = await app.repo.feed({ ...query, before });
      setPosts((current) => [...(current ?? []), ...rows]);
      setMore(rows.length >= 30);
    } catch (error) {
      app.fail(error);
    }
  };

  if (!posts) return <p className="cm-empty">Loading…</p>;
  if (!posts.length) return <p className="cm-empty cm-card">{empty}</p>;
  return (
    <>
      {posts.map((post) => (
        <PostItem
          key={post.entryId}
          post={post}
          app={app}
          now={now}
          // One post can be in the feed twice, as itself and as a repost.
          onChanged={(patch) => setPosts((list) => list?.map((p) => (p.id === post.id ? { ...p, ...patch } : p)) ?? null)}
          onRemoved={() => setPosts((list) => list?.filter((p) => p.id !== post.id) ?? null)}
        />
      ))}
      {more ? (
        <button type="button" className="cm-pill cm-more" onClick={() => void loadMore()}>
          Show more
        </button>
      ) : null}
    </>
  );
}

function Home({ app, now, version, onPosted, tag }: { app: Community; now: number; version: number; onPosted: () => void; tag: string | null }) {
  const [tab, setTab] = useState<'foryou' | 'following'>('foryou');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const feedQuery = useMemo<FeedQuery>(() => {
    if (tag) return { tag };
    // A search for a whole tag or ticker is that tag's feed.
    if (/^[#$][a-z][a-z0-9_]*$/i.test(query)) return { tag: query.toLowerCase() };
    return { tab, query: query || undefined };
  }, [query, tab, tag]);

  return (
    <>
      <section className="cm-card cm-head">
        <div className="cm-head__row">
          <h2>{tag ?? 'Home'}</h2>
          {tag ? (
            <button type="button" className="cm-pill" onClick={() => app.go('/community')}>
              All posts
            </button>
          ) : (
            <label className="cm-search">
              <SearchIcon />
              <input
                value={search}
                placeholder="Search $tickers, #tags or traders"
                aria-label="Search"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          )}
        </div>
        {!tag ? (
          <div className="cm-tabs" role="tablist">
            {(['foryou', 'following'] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
                {id === 'foryou' ? 'For you' : 'Following'}
              </button>
            ))}
          </div>
        ) : null}
      </section>
      {app.me && !tag ? (
        <section className="cm-card">
          <Composer app={app} onPosted={onPosted} />
        </section>
      ) : null}
      <Feed
        app={app}
        query={feedQuery}
        now={now}
        version={version}
        empty={feedQuery.tab === 'following' ? 'Follow some traders and their posts land here.' : 'Nothing here yet. Post the first one.'}
      />
    </>
  );
}

function Explore({ app }: { app: Community }) {
  const [trending, setTrending] = useState<{ tag: string; uses: number }[] | null>(null);
  useEffect(() => {
    app.repo.trending().then(setTrending, (error: unknown) => {
      setTrending([]);
      app.fail(error);
    });
  }, [app.repo]);
  return (
    <>
      <section className="cm-card cm-head">
        <h2>Explore</h2>
        <p className="cm-faint">What traders are talking about this week.</p>
      </section>
      {trending?.length ? (
        <div className="cm-grid">
          {trending.map((item) => (
            <button key={item.tag} type="button" className="cm-card cm-tile" onClick={() => app.openTag(item.tag)}>
              <strong>{item.tag}</strong>
              <span className="cm-faint">
                {item.uses} {item.uses === 1 ? 'post' : 'posts'}
              </span>
            </button>
          ))}
        </div>
      ) : trending ? (
        <p className="cm-empty cm-card">No tags this week yet. Use a #tag or a $ticker in a post.</p>
      ) : null}
    </>
  );
}

const NOTICE_TEXT: Record<Notice['kind'], string> = {
  like: 'liked your post',
  reply: 'replied to your post',
  repost: 'reposted your post',
  follow: 'followed you',
};

function Notifications({ app, now, onRead }: { app: Community; now: number; onRead: () => void }) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const userId = app.me?.id;
  useEffect(() => {
    if (!userId) return;
    app.repo.notifications(userId).then(
      (rows) => {
        setNotices(rows);
        void app.repo.markRead(userId).then(onRead, () => undefined);
      },
      (error: unknown) => {
        setNotices([]);
        app.fail(error);
      },
    );
  }, [userId, app.repo]);
  return (
    <>
      <section className="cm-card cm-head">
        <h2>Notifications</h2>
      </section>
      {notices?.length ? (
        <section className="cm-card cm-notices">
          {notices.map((notice) => (
            <button key={notice.id} type="button" className={notice.read ? '' : 'is-new'} onClick={() => app.go(`/u/${notice.actorHandle}`)}>
              <span className="cm-avatar" aria-hidden="true">
                <Avatar path={notice.actorAvatar} />
              </span>
              <span>
                <strong>{notice.actorName || notice.actorHandle}</strong> {NOTICE_TEXT[notice.kind]}
              </span>
              <span className="cm-spacer" />
              <span className="cm-faint">{timeAgo(notice.createdAt, now)}</span>
            </button>
          ))}
        </section>
      ) : notices ? (
        <p className="cm-empty cm-card">Likes, replies, reposts and follows show up here.</p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* A profile                                                           */
/* ------------------------------------------------------------------ */

function MemberView({
  app,
  handle,
  now,
  version,
  onMe,
  onLogOut,
  onJournal,
}: {
  app: Community;
  handle: string | null;
  now: number;
  version: number;
  onMe: (member: Member) => void;
  onLogOut: (() => void) | null;
  onJournal: (() => void) | null;
}) {
  const own = handle === null || handle === app.me?.handle;
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [stats, setStats] = useState<MemberStats | null>(null);
  const [editing, setEditing] = useState<{ displayName: string; handle: string; bio: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const bannerInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setMember(undefined);
    const load = async () => {
      const found = own ? app.me : handle ? await app.repo.member(handle) : null;
      if (cancelled) return;
      setMember(found);
      if (found) {
        const counts = await app.repo.stats(found.id, app.me?.id ?? null);
        if (!cancelled) setStats(counts);
      }
    };
    load().catch(app.fail);
    return () => {
      cancelled = true;
    };
  }, [handle, own, app.repo, app.me?.id]);

  const apply = (next: Member) => {
    setMember(next);
    onMe(next);
  };

  const replacePicture = async (field: 'avatarPath' | 'bannerPath', files: FileList | null) => {
    const file = files?.[0];
    if (!file || !app.me) return;
    setBusy(true);
    try {
      const { blob } = await normalizeImage(file, field === 'bannerPath' ? 2400 : 800);
      const path = await app.repo.upload(app.me.id, blob);
      const previous = app.me[field];
      apply(await app.repo.updateMember(app.me.id, { [field]: path }));
      if (previous) void app.repo.removeFile(previous).catch(() => undefined);
    } catch (error) {
      app.fail(error);
    } finally {
      setBusy(false);
      if (bannerInput.current) bannerInput.current.value = '';
      if (avatarInput.current) avatarInput.current.value = '';
    }
  };

  const saveEdit = async () => {
    if (!editing || !app.me) return;
    const nextHandle = editing.handle.trim().toLowerCase();
    if (!isValidHandle(nextHandle)) {
      app.say('A handle is 3 to 20 letters, numbers or underscores.');
      return;
    }
    setBusy(true);
    try {
      apply(await app.repo.updateMember(app.me.id, {
        displayName: editing.displayName.trim(),
        handle: nextHandle,
        bio: editing.bio.trim(),
      }));
      setEditing(null);
    } catch (error) {
      app.fail(error);
    } finally {
      setBusy(false);
    }
  };

  const toggleFollow = async () => {
    const userId = app.requireMember();
    if (!userId || !member || !stats) return;
    const on = !stats.followed;
    setStats({ ...stats, followed: on, followers: stats.followers + (on ? 1 : -1) });
    try {
      await app.repo.setFollow(userId, member.id, on);
    } catch (error) {
      setStats(stats);
      app.fail(error);
    }
  };

  if (member === undefined) return <p className="cm-empty">Loading…</p>;
  if (member === null) {
    return <p className="cm-empty cm-card">{handle ? `There is no @${handle} here.` : 'Sign in to see your profile.'}</p>;
  }

  const banner = imageUrl(member.bannerPath);
  return (
    <>
      <section className="cm-card cm-profile">
        <div className="cm-banner">
          {banner ? <img src={banner} alt="" /> : null}
          {own ? (
            <button type="button" className="cm-banner__change" onClick={() => bannerInput.current?.click()} disabled={busy}>
              {member.bannerPath ? 'Change banner' : 'Add banner'}
            </button>
          ) : null}
        </div>
        <input ref={bannerInput} type="file" accept={ACCEPT_ATTR} hidden aria-label="Banner image" onChange={(event) => void replacePicture('bannerPath', event.target.files)} />
        <input ref={avatarInput} type="file" accept={ACCEPT_ATTR} hidden aria-label="Profile picture" onChange={(event) => void replacePicture('avatarPath', event.target.files)} />
        <div className="cm-profile__body">
          <div className="cm-profile__row">
            <button
              type="button"
              className="cm-avatar cm-avatar--large"
              onClick={() => own && avatarInput.current?.click()}
              disabled={!own || busy}
              aria-label={own ? 'Change profile picture' : `${member.handle}'s picture`}
            >
              <Avatar path={member.avatarPath} />
            </button>
            <div className="cm-profile__actions">
              {own ? (
                <>
                  {onJournal ? (
                    <button type="button" className="cm-pill" onClick={onJournal}>
                      Journal
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="cm-pill"
                    onClick={() => setEditing({ displayName: member.displayName, handle: member.handle, bio: member.bio })}
                    disabled={editing !== null}
                  >
                    Edit profile
                  </button>
                  {onLogOut ? (
                    <>
                      {PLANS_ENABLED ? (
                        <button type="button" className="cm-pill" onClick={() => navigate(PRICING_PATH)}>
                          Plans
                        </button>
                      ) : null}
                      <button type="button" className="cm-pill" onClick={onLogOut}>
                        Log out
                      </button>
                    </>
                  ) : null}
                </>
              ) : (
                <button type="button" className={`cm-pill${stats?.followed ? '' : ' cm-pill--dark'}`} onClick={() => void toggleFollow()}>
                  {stats?.followed ? 'Following' : 'Follow'}
                </button>
              )}
            </div>
          </div>
          {editing ? (
            <form
              className="cm-edit"
              onSubmit={(event) => {
                event.preventDefault();
                void saveEdit();
              }}
            >
              <label>
                <span>Name</span>
                <input className="cm-field" value={editing.displayName} maxLength={MAX_NAME} onChange={(event) => setEditing({ ...editing, displayName: event.target.value })} autoFocus />
              </label>
              <label>
                <span>Handle</span>
                <input className="cm-field" value={editing.handle} maxLength={20} onChange={(event) => setEditing({ ...editing, handle: event.target.value })} />
              </label>
              <label>
                <span>Bio</span>
                <textarea className="cm-field" value={editing.bio} maxLength={MAX_BIO} rows={3} onChange={(event) => setEditing({ ...editing, bio: event.target.value })} />
              </label>
              <div className="cm-edit__actions">
                <button type="button" className="cm-pill" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="submit" className="cm-pill cm-pill--dark" disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <h2>{member.displayName || member.handle}</h2>
              <p className="cm-faint">@{member.handle}</p>
              {member.bio ? <p className="cm-profile__bio">{member.bio}</p> : null}
            </>
          )}
          {stats ? (
            <p className="cm-stats">
              <span><b>{stats.following}</b> following</span>
              <span><b>{stats.followers}</b> followers</span>
              <span><b>{stats.posts}</b> posts</span>
            </p>
          ) : null}
        </div>
      </section>
      <Feed app={app} query={{ authorId: member.id }} now={now} version={version} empty="No posts yet." />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The right rail                                                      */
/* ------------------------------------------------------------------ */

function Rail({ app, stamp }: { app: Community; stamp: number }) {
  const [members, setMembers] = useState<Member[]>([]);
  const me = app.me;

  useEffect(() => {
    app.repo.suggestions(me?.id ?? null).then(setMembers, () => setMembers([]));
  }, [app.repo, me?.id, stamp]);

  const follow = async (member: Member) => {
    const userId = app.requireMember();
    if (!userId) return;
    setMembers((list) => list.filter((m) => m.id !== member.id));
    try {
      await app.repo.setFollow(userId, member.id, true);
    } catch (error) {
      setMembers((list) => [member, ...list]);
      app.fail(error);
    }
  };

  const banner = imageUrl(me?.bannerPath ?? null);
  return (
    <aside className="cm-rail" aria-label="Your profile and suggestions">
      {me ? (
        <section className="cm-card cm-mini">
          <div className="cm-banner">{banner ? <img src={banner} alt="" /> : null}</div>
          <div className="cm-mini__body">
            <span className="cm-avatar cm-avatar--medium" aria-hidden="true">
              <Avatar path={me.avatarPath} />
            </span>
            <strong>{me.displayName || me.handle}</strong>
            <p className="cm-faint">@{me.handle}</p>
            <button type="button" className="cm-pill" onClick={() => app.go('/profile')}>
              View profile
            </button>
          </div>
        </section>
      ) : (
        <section className="cm-card cm-join">
          <strong>Join the community</strong>
          <p className="cm-faint">Post your cards, follow traders and find your people.</p>
          <button type="button" className="cm-pill cm-pill--dark" onClick={() => app.requireMember()}>
            Sign in
          </button>
        </section>
      )}
      {members.length ? (
        <section className="cm-card cm-who">
          <h3>Who to follow</h3>
          {members.map((member) => (
            <div key={member.id} className="cm-who__row">
              <button type="button" className="cm-avatar" onClick={() => app.go(`/u/${member.handle}`)} aria-label={`Open ${member.handle}`}>
                <Avatar path={member.avatarPath} />
              </button>
              <div className="cm-who__name">
                <strong>{member.displayName || member.handle}</strong>
                <span className="cm-faint">@{member.handle}</span>
              </div>
              <button type="button" className="cm-pill cm-pill--dark" onClick={() => void follow(member)}>
                Follow
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

export function CommunityPage() {
  const { pathname, search } = useLocation();
  const { user, userId, mode, session, loading, signOut } = useAuth();
  const view = viewFor(pathname, search);
  const repo = useMemo(community, []);
  const [me, setMe] = useState<Member | null>(null);
  const [notInstalled, setNotInstalled] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [composing, setComposing] = useState<{ initial: Blob | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [unread, setUnread] = useState(0);
  const [journalOpen, setJournalOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const signedIn = mode === 'local' || Boolean(session);
  // Only a name they gave. `displayNameFor` falls back to the start of the email
  // address, which must never reach this public table.
  const given = user?.user_metadata?.display_name;
  const accountName = mode === 'local' ? 'You' : typeof given === 'string' ? given.trim() : '';
  const memberId = signedIn ? userId : null;

  const say = useCallback((text: string) => setToast({ text, error: false }), []);
  const fail = useCallback((error: unknown) => {
    if (isNotInstalled(error)) setNotInstalled(true);
    else setToast({ text: messageOf(error), error: true });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!memberId) {
      setMe(null);
      return;
    }
    let cancelled = false;
    repo.ensureMember(memberId, accountName).then(
      (member) => {
        if (!cancelled) setMe(member);
      },
      (error: unknown) => {
        if (!cancelled) fail(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [accountName, fail, memberId, repo]);

  useEffect(() => {
    if (!me) return;
    repo.notifications(me.id).then((rows) => setUnread(rows.filter((n) => !n.read).length), () => undefined);
  }, [me?.id, pathname, repo]);

  // A card sent from the editor opens the Post dialog with it attached.
  useEffect(() => {
    if (!me) return;
    const pending = takePendingImage();
    if (pending) setComposing({ initial: pending });
  }, [me?.id]);

  const go = useCallback((path: string) => navigate(path), []);

  const requireMember = useCallback(() => {
    if (me) return me.id;
    if (signedIn) return null;
    setAfterSignIn(`${location.pathname}${location.search}`);
    navigate(STUDIO_PATH);
    return null;
  }, [me, signedIn]);

  const app = useMemo<Community>(
    () => ({
      repo,
      me,
      requireMember,
      go,
      openTag: (tag) => navigate(`/community?tag=${encodeURIComponent(tag)}`),
      say,
      fail,
    }),
    [fail, go, me, repo, requireMember, say],
  );

  const logOut = useCallback(() => {
    void signOut().then(() => navigate(HOME_PATH), fail);
  }, [fail, signOut]);

  const posted = useCallback(() => {
    setComposing(null);
    setVersion((n) => n + 1);
  }, []);

  const NAV = [
    { id: 'home', label: 'Home', path: '/community', icon: <HomeIcon /> },
    { id: 'explore', label: 'Explore', path: '/community/explore', icon: <CompassIcon /> },
    ...(me
      ? [
          { id: 'notifications', label: 'Notifications', path: '/community/notifications', icon: <BellIcon /> },
          { id: 'bookmarks', label: 'Bookmarks', path: '/community/bookmarks', icon: <BookmarkIcon /> },
          { id: 'member', label: 'Profile', path: '/profile', icon: <UserIcon /> },
        ]
      : []),
    { id: 'cards', label: 'Make a card', path: STUDIO_PATH, icon: <CardIcon /> },
  ];
  const activeNav = view.kind === 'tag' ? 'home' : view.kind === 'member' && view.handle && view.handle !== me?.handle ? '' : view.kind;

  return (
    <div className="app cm">
      <header className="topbar">
        <SiteNav current="community" />
        <div className="topbar__actions">
          {signedIn ? (
            <ProfileMenu />
          ) : (
            <>
              <button type="button" className="btn btn--primary btn--small" onClick={() => app.requireMember()} disabled={loading}>
                Sign in
              </button>
              <ThemeMenu />
            </>
          )}
        </div>
      </header>

      {notInstalled ? (
        <p className="cm-setup" role="status">
          The community tables are not in the database yet. Run <code>supabase/schema.sql</code> in Supabase.
        </p>
      ) : null}

      <div className="cm-layout">
        <nav className="cm-nav cm-card" aria-label="Community">
          <button type="button" className="cm-post-btn" onClick={() => (app.requireMember() ? setComposing({ initial: null }) : undefined)}>
            <PlusIcon /> Post
          </button>
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`cm-nav__item${activeNav === item.id ? ' is-active' : ''}`}
              aria-current={activeNav === item.id ? 'page' : undefined}
              onClick={() => go(item.path)}
            >
              <span className="cm-nav__icon">
                {item.icon}
                {item.id === 'notifications' && unread > 0 ? <i>{unread > 9 ? '9+' : unread}</i> : null}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
          {me ? (
            <button type="button" className="cm-nav__me" onClick={() => go('/profile')}>
              <span className="cm-avatar" aria-hidden="true">
                <Avatar path={me.avatarPath} />
              </span>
              <span>
                <strong>{me.displayName || me.handle}</strong>
                <em>@{me.handle}</em>
              </span>
            </button>
          ) : null}
        </nav>

        <main className="cm-center">
          {view.kind === 'home' ? <Home app={app} now={now} version={version} onPosted={posted} tag={null} /> : null}
          {view.kind === 'tag' ? <Home app={app} now={now} version={version} onPosted={posted} tag={view.tag} /> : null}
          {view.kind === 'explore' ? <Explore app={app} /> : null}
          {view.kind === 'notifications' ? <Notifications app={app} now={now} onRead={() => setUnread(0)} /> : null}
          {view.kind === 'bookmarks' ? (
            <>
              <section className="cm-card cm-head">
                <h2>Bookmarks</h2>
              </section>
              <Feed app={app} query={{ tab: 'bookmarks' }} now={now} version={version} empty="Posts you bookmark are kept here. Only you can see them." />
            </>
          ) : null}
          {view.kind === 'member' ? (
            <MemberView
              app={app}
              handle={view.handle}
              now={now}
              version={version}
              onMe={setMe}
              onLogOut={mode === 'account' ? logOut : null}
              onJournal={JOURNAL_ENABLED ? () => setJournalOpen(true) : null}
            />
          ) : null}
        </main>

        <Rail app={app} stamp={version} />
      </div>

      {composing ? (
        <div
          className="cm-dialog"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setComposing(null);
          }}
        >
          <div className="cm-dialog__panel" role="dialog" aria-modal="true" aria-label="New post">
            <header>
              <h2>New post</h2>
              <button type="button" className="cm-iconbtn cm-iconbtn--soft" onClick={() => setComposing(null)} aria-label="Close">
                <CloseIcon />
              </button>
            </header>
            <Composer app={app} full initial={composing.initial} onPosted={posted} />
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="toast-area" aria-live="polite">
          <div className={`toast toast--${toast.error ? 'error' : 'info'}`}>{toast.text}</div>
        </div>
      ) : null}

      {JOURNAL_ENABLED && journalOpen ? (
        <Suspense fallback={null}>
          <JournalModal
            name={me?.displayName || accountName}
            accountLabel={mode === 'account' ? (user?.email ?? '') : 'Saved in this browser'}
            onClose={() => setJournalOpen(false)}
            onOpenPlans={mode === 'account' && PLANS_ENABLED ? () => navigate(PRICING_PATH) : undefined}
            onSignOut={mode === 'account' ? logOut : undefined}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
