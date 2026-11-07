import { useEffect, useRef, useState } from 'react';
import { ACCEPT_ATTR, normalizeImage } from '../lib/images';
import { canPublish, MAX_BODY, MAX_HEADING, MAX_IMAGES } from './text';
import { CloseIcon, PhotoIcon } from './icons';
import { Avatar, type Community } from './shared';

const QUICK_TAGS = ['#recap', '#ICT', '#FVG', '#propfirm', '#psychology', '#discipline', '#risk', '#scalping', '#backtest'];

interface Attached {
  blob: Blob;
  url: string;
}

function attachment(blob: Blob): Attached {
  return { blob, url: URL.createObjectURL(blob) };
}

/**
 * Writes a post or a reply. `full` is the larger form in the Post dialog, with
 * a heading, quick tags and a ticker.
 */
export function Composer({
  app,
  replyTo,
  full = false,
  initial = null,
  onPosted,
}: {
  app: Community;
  replyTo?: string;
  full?: boolean;
  /** A picture already attached: a card sent from the editor. */
  initial?: Blob | null;
  onPosted: () => void;
}) {
  const [heading, setHeading] = useState('');
  const [body, setBody] = useState('');
  const [ticker, setTicker] = useState('');
  const [images, setImages] = useState<Attached[]>(() => (initial ? [attachment(initial)] : []));
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const urls = useRef<string[]>([]);
  urls.current = images.map((image) => image.url);
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const left = MAX_BODY - body.trim().length;
  const ready = canPublish(body, images.length) && !busy;

  const addFiles = async (files: FileList | null) => {
    const room = MAX_IMAGES - images.length;
    const picked = [...(files ?? [])].slice(0, room);
    if (inputRef.current) inputRef.current.value = '';
    try {
      // Re-encoded here, which also drops the location and camera data a phone
      // photo carries. Nothing a person uploads reaches the public bucket as-is.
      const added = await Promise.all(picked.map((file) => normalizeImage(file, 2000)));
      setImages((current) => [...current, ...added.map((image) => attachment(image.blob))]);
    } catch (error) {
      app.fail(error);
    }
  };

  const dropImage = (url: string) => {
    URL.revokeObjectURL(url);
    setImages((current) => current.filter((image) => image.url !== url));
  };

  const addTag = (tag: string) => {
    const has = body.toLowerCase().split(/\s+/).includes(tag.toLowerCase());
    if (!has) setBody((text) => `${text.trimEnd()}${text.trim() ? ' ' : ''}${tag}`);
  };

  const publish = async () => {
    const userId = app.requireMember();
    if (!userId || !ready) return;
    setBusy(true);
    try {
      const paths = await Promise.all(images.map((image) => app.repo.upload(userId, image.blob)));
      const symbol = ticker.trim().replace(/^\$/, '').toUpperCase();
      const text = symbol ? `${body.trim()} $${symbol}`.trim() : body.trim();
      await app.repo.addPost(userId, { heading: heading.trim(), body: text, images: paths, replyTo });
      setHeading('');
      setBody('');
      setTicker('');
      images.forEach((image) => URL.revokeObjectURL(image.url));
      setImages([]);
      onPosted();
    } catch (error) {
      app.fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`cm-compose${full ? ' cm-compose--full' : ''}${replyTo ? ' cm-compose--reply' : ''}`}>
      {!full ? (
        <span className="cm-avatar" aria-hidden="true">
          <Avatar path={app.me?.avatarPath ?? null} />
        </span>
      ) : null}
      <div className="cm-compose__main">
        {full ? (
          <input
            className="cm-field"
            value={heading}
            maxLength={MAX_HEADING}
            placeholder="Heading (optional)"
            aria-label="Heading"
            onChange={(event) => setHeading(event.target.value)}
          />
        ) : null}
        <textarea
          className={full ? 'cm-field' : ''}
          value={body}
          rows={full ? 6 : 2}
          autoFocus={full}
          placeholder={replyTo ? 'Write a reply…' : 'Share a trade, a lesson, a setup…'}
          aria-label={replyTo ? 'Reply' : 'Post text'}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void publish();
          }}
        />
        {images.length ? (
          <div className="cm-attached">
            {images.map((image) => (
              <div key={image.url}>
                <img src={image.url} alt="Attached" />
                <button type="button" onClick={() => dropImage(image.url)} aria-label="Remove the image">
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {full ? (
          <>
            <div className="cm-chips">
              {QUICK_TAGS.map((tag) => (
                <button key={tag} type="button" className="cm-pill" onClick={() => addTag(tag)}>
                  {tag}
                </button>
              ))}
            </div>
            <input
              className="cm-field cm-field--ticker"
              value={ticker}
              maxLength={12}
              placeholder="$ Ticker"
              aria-label="Ticker"
              onChange={(event) => setTicker(event.target.value)}
            />
          </>
        ) : null}
        <div className="cm-compose__bar">
          {!replyTo ? (
            <button
              type="button"
              className="cm-iconbtn cm-iconbtn--soft"
              onClick={() => inputRef.current?.click()}
              disabled={images.length >= MAX_IMAGES}
              aria-label={`Add photos, ${images.length} of ${MAX_IMAGES}`}
              title={`Add photos ${images.length}/${MAX_IMAGES}`}
            >
              <PhotoIcon />
            </button>
          ) : null}
          <input ref={inputRef} type="file" accept={ACCEPT_ATTR.replace('image/gif,', '').replace(',image/gif', '')} multiple hidden aria-label="Post images" onChange={(event) => void addFiles(event.target.files)} />
          <span className="cm-spacer" />
          {left < 200 ? <span className={`cm-count${left < 0 ? ' is-over' : ''}`}>{left}</span> : null}
          <button type="button" className="cm-pill cm-pill--dark cm-pill--large" onClick={() => void publish()} disabled={!ready}>
            {busy ? 'Posting…' : replyTo ? 'Reply' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}
