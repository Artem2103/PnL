import { useEffect, useState } from 'react';
import { imageUrl, type FeedPost, type ReportReason } from './repository';
import { timeAgo, tokenize } from './text';
import {
  BookmarkIcon,
  CloseIcon,
  HeartIcon,
  MoreIcon,
  ReplyIcon,
  RepostIcon,
  ShareIcon,
} from './icons';
import { Avatar, type Community } from './shared';
import { Composer } from './Composer';

function Body({ text, onTag, onMember }: { text: string; onTag: (tag: string) => void; onMember: (handle: string) => void }) {
  return (
    <p className="cm-post__body">
      {tokenize(text).map((token, index) => {
        if (token.kind === 'text') return <span key={index}>{token.text}</span>;
        return (
          <button
            key={index}
            type="button"
            className="cm-link"
            onClick={() => (token.kind === 'tag' ? onTag(token.tag) : onMember(token.handle))}
          >
            {token.text}
          </button>
        );
      })}
    </p>
  );
}

const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'spam', label: 'Spam' },
  { id: 'scam', label: 'Scam' },
  { id: 'abuse', label: 'Abuse' },
  { id: 'other', label: 'Something else' },
];

export function PostItem({
  post,
  app,
  now,
  onChanged,
  onRemoved,
  isReply = false,
}: {
  post: FeedPost;
  app: Community;
  now: number;
  onChanged: (patch: Partial<FeedPost>) => void;
  onRemoved: () => void;
  isReply?: boolean;
}) {
  const [menu, setMenu] = useState<null | 'open' | 'report'>(null);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [replies, setReplies] = useState<FeedPost[] | null>(null);
  const mine = app.me?.id === post.userId;

  const loadReplies = async () => {
    try {
      setReplies((await app.repo.feed({ parentId: post.id })).reverse());
    } catch (error) {
      app.fail(error);
    }
  };

  useEffect(() => {
    if (repliesOpen && !replies) void loadReplies();
  }, [repliesOpen]);

  /** The screen changes first; a failed save puts it back and says so. */
  const optimistic = async (patch: Partial<FeedPost>, undo: Partial<FeedPost>, save: (userId: string) => Promise<void>) => {
    const userId = app.requireMember();
    if (!userId) return;
    onChanged(patch);
    try {
      await save(userId);
    } catch (error) {
      onChanged(undo);
      app.fail(error);
    }
  };

  const like = () =>
    optimistic(
      { liked: !post.liked, likeCount: post.likeCount + (post.liked ? -1 : 1) },
      { liked: post.liked, likeCount: post.likeCount },
      (userId) => app.repo.setLike(userId, post.id, !post.liked),
    );
  const repost = () =>
    optimistic(
      { reposted: !post.reposted, repostCount: post.repostCount + (post.reposted ? -1 : 1) },
      { reposted: post.reposted, repostCount: post.repostCount },
      (userId) => app.repo.setRepost(userId, post.id, !post.reposted),
    );
  const bookmark = () =>
    optimistic({ bookmarked: !post.bookmarked }, { bookmarked: post.bookmarked }, (userId) =>
      app.repo.setBookmark(userId, post.id, !post.bookmarked),
    );
  const follow = () =>
    optimistic({ following: true }, { following: false }, (userId) => app.repo.setFollow(userId, post.userId, true));

  const share = async () => {
    const url = `${location.origin}/u/${post.handle}`;
    try {
      await navigator.clipboard.writeText(url);
      app.say('Link copied.');
    } catch {
      app.say(url);
    }
  };

  const remove = async () => {
    setMenu(null);
    try {
      await app.repo.deletePost(post.id);
      for (const path of post.images) void app.repo.removeFile(path).catch(() => undefined);
      onRemoved();
    } catch (error) {
      app.fail(error);
    }
  };

  const report = async (reason: ReportReason) => {
    const userId = app.requireMember();
    setMenu(null);
    if (!userId) return;
    try {
      await app.repo.report(userId, post.id, reason);
      app.say('Thanks. That post has been reported.');
    } catch (error) {
      app.fail(error);
    }
  };

  const toMember = () => app.go(`/u/${post.handle}`);

  return (
    <article className={`cm-post${isReply ? ' cm-post--reply' : ' cm-card'}`}>
      {post.repostedBy ? (
        <p className="cm-post__repost">
          <RepostIcon /> @{post.repostedBy} reposted
        </p>
      ) : null}
      <div className="cm-post__row">
        <button type="button" className="cm-avatar" onClick={toMember} aria-label={`Open ${post.handle}`}>
          <Avatar path={post.avatarPath} />
        </button>
        <div className="cm-post__main">
          <header className="cm-post__head">
            <button type="button" className="cm-post__name" onClick={toMember}>
              {post.displayName || post.handle}
            </button>
            <span className="cm-faint">
              @{post.handle} · {timeAgo(post.createdAt, now)}
            </span>
            <span className="cm-spacer" />
            {!mine && !post.following && !isReply ? (
              <button type="button" className="cm-pill cm-pill--dark" onClick={() => void follow()}>
                Follow
              </button>
            ) : null}
            <button type="button" className="cm-iconbtn" onClick={() => setMenu(menu ? null : 'open')} aria-label="More" aria-expanded={menu !== null}>
              {menu ? <CloseIcon /> : <MoreIcon />}
            </button>
          </header>

          {menu ? (
            <div className="cm-menu" role="menu">
              {menu === 'open' ? (
                mine ? (
                  <button type="button" role="menuitem" className="is-danger" onClick={() => void remove()}>
                    Delete post
                  </button>
                ) : (
                  <button type="button" role="menuitem" onClick={() => setMenu('report')}>
                    Report post
                  </button>
                )
              ) : (
                REASONS.map((reason) => (
                  <button key={reason.id} type="button" role="menuitem" onClick={() => void report(reason.id)}>
                    {reason.label}
                  </button>
                ))
              )}
            </div>
          ) : null}

          {post.heading ? <h3 className="cm-post__heading">{post.heading}</h3> : null}
          {post.body ? <Body text={post.body} onTag={app.openTag} onMember={(handle) => app.go(`/u/${handle}`)} /> : null}
          {post.images.length ? (
            <div className={`cm-images cm-images--${Math.min(post.images.length, 4)}`}>
              {post.images.map((path) => (
                <img key={path} src={imageUrl(path) ?? ''} alt="" loading="lazy" />
              ))}
            </div>
          ) : null}

          <footer className="cm-actions">
            <button type="button" onClick={() => setRepliesOpen((open) => !open)} aria-label="Reply" aria-expanded={repliesOpen}>
              <ReplyIcon /> {post.replyCount || ''}
            </button>
            {!isReply ? (
              <button type="button" className={post.reposted ? 'is-repost' : ''} onClick={() => void repost()} aria-label="Repost" aria-pressed={post.reposted}>
                <RepostIcon /> {post.repostCount || ''}
              </button>
            ) : null}
            <button type="button" className={post.liked ? 'is-liked' : ''} onClick={() => void like()} aria-label="Like" aria-pressed={post.liked}>
              <HeartIcon on={post.liked} /> {post.likeCount || ''}
            </button>
            <button type="button" className={post.bookmarked ? 'is-saved' : ''} onClick={() => void bookmark()} aria-label="Bookmark" aria-pressed={post.bookmarked}>
              <BookmarkIcon on={post.bookmarked} />
            </button>
            <button type="button" onClick={() => void share()} aria-label="Copy link">
              <ShareIcon />
            </button>
          </footer>

          {repliesOpen ? (
            <div className="cm-replies">
              {replies?.map((reply) => (
                <PostItem
                  key={reply.entryId}
                  post={reply}
                  app={app}
                  now={now}
                  isReply
                  onChanged={(patch) => setReplies((list) => list?.map((r) => (r.id === reply.id ? { ...r, ...patch } : r)) ?? null)}
                  onRemoved={() => {
                    setReplies((list) => list?.filter((r) => r.id !== reply.id) ?? null);
                    onChanged({ replyCount: Math.max(0, post.replyCount - 1) });
                  }}
                />
              ))}
              <Composer
                app={app}
                replyTo={post.id}
                onPosted={() => {
                  onChanged({ replyCount: post.replyCount + 1 });
                  void loadReplies();
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
