import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardState } from '../../types';
import { CardPreview } from '../../components/CardPreview';
import { LimitDialog } from '../../components/LimitDialog';
import { canCopyImage, copyCardToClipboard, downloadCard } from '../../lib/share';
import { MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES, peekMedia } from '../../lib/images';
import {
  acceptAttrFor,
  addMedia,
  listMedia,
  maxImagesFor,
  releaseThumbnails,
  type MediaSummary,
} from '../../lib/library';
import { downloadCardVideo, resolveClip, videoSupport } from '../../lib/video';
import { claimExport, type ExportFormat, type PlanStatus } from '../../lib/billing';
import { PRICING_PATH, navigate } from '../../lib/route';
import { CARD } from '../../lib/render';
import { SCENES, drawScene, sceneById } from '../../lib/canvas/scenes';
import { useAuth } from '../../lib/auth';
import { journalCardState, loadCardDesign, type ShareSubject } from '../shareCard';
import { Overlay } from './Overlay';
import {
  CloseIcon,
  CopyIcon,
  CustomizeIcon,
  DownloadIcon,
  ImageIcon,
  PauseIcon,
  PlayIcon,
  SwapIcon,
  TrashIcon,
  AdvancedIcon,
  VideoIcon,
} from './icons';

const EXPORT_SCALE = 2;
const THUMB_W = 118;
const THUMB_H = 80;

/** What the card is painted over, chosen in the strip under it. */
type Background = { kind: 'scene'; id: string } | { kind: 'media'; id: string } | { kind: 'none' };

function backgroundOf(design: CardState): Background {
  if (design.artwork.imageId) return { kind: 'media', id: design.artwork.imageId };
  const scene = sceneById(design.artwork.sceneId);
  return scene ? { kind: 'scene', id: scene.id } : { kind: 'none' };
}

function withBackground(design: CardState, background: Background): CardState {
  return {
    ...design,
    artwork: {
      ...design.artwork,
      imageId: background.kind === 'media' ? background.id : null,
      sceneId: background.kind === 'scene' ? background.id : 'none',
    },
  };
}

function seconds(value: number): string {
  const s = Math.max(0, Math.floor(value));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/** A built-in background, painted by the scene itself and cropped like a photo tile. */
const SceneThumb = memo(function SceneThumb({ sceneId }: { sceneId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const scene = sceneById(sceneId);
    if (!canvas || !scene) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = THUMB_W * dpr;
    canvas.height = THUMB_H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = Math.max(THUMB_W / CARD.width, THUMB_H / CARD.height) * dpr;
    ctx.setTransform(scale, 0, 0, scale, (THUMB_W * dpr - CARD.width * scale) / 2, (THUMB_H * dpr - CARD.height * scale) / 2);
    drawScene(ctx, CARD.width, CARD.height, scene);
  }, [sceneId]);
  return <canvas ref={ref} style={{ width: THUMB_W, height: THUMB_H }} aria-hidden="true" />;
});

/**
 * The existing PnL card — same renderer, same preview, same export and the
 * same plan check as the editor — filled with a trade, a month or a period,
 * laid out like the reference's share sheet: the card, an Image / Video
 * switch, a strip of backgrounds, and the actions.
 */
export function ShareCardModal({
  userId,
  subject,
  currency,
  onClose,
  onCustomize,
}: {
  userId: string;
  subject: ShareSubject;
  currency: string;
  onClose: () => void;
  /** Leaves for the card editor, closing the journal on the way. */
  onCustomize: () => void;
}) {
  const { librarySyncedAt } = useAuth();
  const [design, setDesign] = useState<CardState | null>(null);
  const [background, setBackground] = useState<Background | null>(null);
  const [mode, setMode] = useState<'image' | 'video'>('image');
  const [media, setMedia] = useState<MediaSummary[]>([]);
  const [busy, setBusy] = useState<null | ExportFormat | 'upload'>(null);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [limit, setLimit] = useState<PlanStatus | null>(null);
  const [playing, setPlaying] = useState(true);
  const [clock, setClock] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaSummary[]>([]);
  const video = useMemo(videoSupport, []);

  useEffect(() => {
    let cancelled = false;
    void loadCardDesign(userId).then((loaded) => {
      if (cancelled) return;
      setDesign(loaded);
      setBackground(backgroundOf(loaded));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    try {
      const next = await listMedia('artwork', userId);
      releaseThumbnails(mediaRef.current);
      mediaRef.current = next;
      setMedia(next);
    } catch {
      /* The strip just shows the built-in background. */
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    return () => {
      releaseThumbnails(mediaRef.current);
      mediaRef.current = [];
    };
  }, [librarySyncedAt, refresh]);

  // Opening on a clip opens the Video side, as the clip is what the card shows.
  const selectedMedia = background?.kind === 'media' ? media.find((m) => m.id === background.id) : undefined;
  const selectedIsClip = selectedMedia?.kind === 'video';
  useEffect(() => {
    if (selectedIsClip) setMode('video');
  }, [selectedIsClip]);

  const images = media.filter((m) => m.kind === 'image');
  const clips = media.filter((m) => m.kind === 'video');

  const state = useMemo(() => {
    if (!design || !background) return null;
    // The Video side shows a clip or nothing; a still behind it would be a lie.
    if (mode === 'video' && !selectedIsClip) return null;
    return journalCardState(withBackground(design, background), subject, currency);
  }, [background, currency, design, mode, selectedIsClip, subject]);

  const clip = useMemo(() => {
    if (!state || !selectedMedia || !selectedIsClip) return null;
    return resolveClip(selectedMedia.duration, state.artwork.clipStart, state.artwork.clipLength);
  }, [selectedIsClip, selectedMedia, state]);

  // The playback clock reads the preview's own <video>, so the bar shows where
  // the card actually is rather than a timer that could drift from it.
  useEffect(() => {
    if (!clip || background?.kind !== 'media') return;
    let frame = 0;
    const tick = () => {
      const element = peekMedia(background.id)?.element;
      if (element instanceof HTMLVideoElement) setClock(Math.max(0, element.currentTime - clip.start));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [background, clip]);

  const gate = useCallback(async (card: CardState, format: ExportFormat) => {
    try {
      const decision = await claimExport(card, format);
      if (!decision.allowed) setLimit(decision.status);
      return decision.allowed;
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : 'Could not check your plan.', tone: 'error' });
      return false;
    }
  }, []);

  const run = useCallback(
    async (format: ExportFormat) => {
      if (!state) return;
      setBusy(format);
      setNote(null);
      try {
        if (format === 'copy') {
          // Started inside the click: Safari only lets the clipboard be
          // written from there, so the plan check rides along in the write.
          const allowed = gate(state, 'copy');
          try {
            await copyCardToClipboard(
              state,
              EXPORT_SCALE,
              allowed.then((ok) => {
                if (!ok) throw new Error('Export not allowed.');
              }),
            );
            setNote({ text: 'Card copied to clipboard.', tone: 'info' });
          } catch (error) {
            if (await allowed) throw error;
          }
          return;
        }
        if (!(await gate(state, format))) return;
        if (format === 'mp4') {
          setProgress(0);
          const wasPlaying = playing;
          setPlaying(false);
          try {
            await downloadCardVideo(state, { scale: EXPORT_SCALE, onProgress: setProgress });
          } finally {
            setPlaying(wasPlaying);
          }
          setNote({ text: 'Video downloaded.', tone: 'info' });
        } else {
          await downloadCard(state, EXPORT_SCALE);
          setNote({ text: 'PNG downloaded.', tone: 'info' });
        }
      } catch (error) {
        setNote({ text: error instanceof Error ? error.message : 'Export failed.', tone: 'error' });
      } finally {
        setBusy(null);
      }
    },
    [gate, playing, state],
  );

  const upload = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      setBusy('upload');
      setNote(null);
      try {
        // The same library the editor uploads to: the file joins the account's
        // backgrounds and shows up in the editor's picker too.
        const record = await addMedia(file, 'artwork', userId, (error) => {
          if (error) setNote({ text: error.message, tone: 'error' });
          void refresh();
        });
        await refresh();
        setBackground({ kind: 'media', id: record.id });
      } catch (error) {
        setNote({ text: error instanceof Error ? error.message : 'Upload failed.', tone: 'error' });
      } finally {
        setBusy(null);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [refresh, userId],
  );

  const isSelected = (candidate: Background) =>
    background?.kind === candidate.kind &&
    (candidate.kind === 'none' || (background.kind !== 'none' && background.id === (candidate as { id: string }).id));

  const tile = (key: string, candidate: Background, label: string, children: React.ReactNode) => (
    <button
      key={key}
      type="button"
      className={`jx-thumb${isSelected(candidate) ? ' is-selected' : ''}`}
      onClick={() => setBackground(candidate)}
      aria-pressed={isSelected(candidate)}
      title={label}
    >
      {children}
    </button>
  );

  return (
    <Overlay label="Share card" className={`jx-share${mode === 'video' ? ' jx-share--video' : ''}`} onClose={onClose}>
      <div className="jx-share__card">
        {state ? (
          <CardPreview state={state} canvasRef={canvasRef} playing={playing} />
        ) : (
          <div className="jx-share__empty">{design ? (mode === 'video' ? 'No Video' : '') : 'Loading your card…'}</div>
        )}
        <button type="button" className="jx-sr" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>

      <div className="jx-share__row">
        <div className="jx-segment" role="group" aria-label="Format">
          <button
            type="button"
            className={mode === 'image' ? 'is-active' : ''}
            aria-pressed={mode === 'image'}
            onClick={() => {
              setMode('image');
              if (!selectedIsClip || !design) return;
              // Back to the card's own still, or the house sky if its own
              // background is this clip.
              const own = backgroundOf(design);
              const ownIsClip = own.kind === 'media' && media.some((m) => m.id === own.id && m.kind === 'video');
              setBackground(ownIsClip ? { kind: 'scene', id: SCENES[0]?.id ?? 'astra' } : own);
            }}
          >
            <ImageIcon /> Image
          </button>
          <button
            type="button"
            className={mode === 'video' ? 'is-active' : ''}
            aria-pressed={mode === 'video'}
            onClick={() => setMode('video')}
          >
            <VideoIcon /> Video
          </button>
        </div>
        {note ? (
          <span className={`jx-share__note${note.tone === 'error' ? ' is-error' : ''}`} role="status">
            {note.text}
          </span>
        ) : (
          <span className="jx-spacer" />
        )}
        {mode === 'video' ? (
          <>
            <button
              type="button"
              className="jx-iconbtn"
              onClick={() => design && setBackground({ kind: 'none' })}
              disabled={!selectedIsClip}
              aria-label="Remove the clip"
              title="Remove the clip"
            >
              <TrashIcon />
            </button>
            <button type="button" className="jx-sbtn jx-sbtn--pill" onClick={onCustomize} title="Trim the clip in the card editor">
              <AdvancedIcon /> Advanced
            </button>
          </>
        ) : null}
      </div>

      {mode === 'video' ? (
        <div className="jx-player">
          <button
            type="button"
            className="jx-player__play"
            onClick={() => setPlaying((value) => !value)}
            disabled={!clip}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing && clip ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span>{seconds(clip ? Math.min(clock, clip.length) : 0)}</span>
          <span className="jx-player__track">
            <span style={{ width: `${clip?.length ? Math.min(100, (clock / clip.length) * 100) : 0}%` }} />
          </span>
          <span>{seconds(clip?.length ?? 0)}</span>
        </div>
      ) : null}

      <div className="jx-strip">
        <div className="jx-strip__thumbs">
          {mode === 'image' ? (
            <>
              {SCENES.map((scene) =>
                tile(scene.id, { kind: 'scene', id: scene.id }, scene.name, <SceneThumb sceneId={scene.id} />),
              )}
              {images.map((item) =>
                tile(item.id, { kind: 'media', id: item.id }, item.name, <img src={item.url} alt="" loading="lazy" />),
              )}
            </>
          ) : (
            clips.map((item) =>
              tile(
                item.id,
                { kind: 'media', id: item.id },
                item.name,
                item.posterUrl ? (
                  <img src={item.posterUrl} alt="" loading="lazy" />
                ) : (
                  <video src={item.url} muted playsInline preload="metadata" />
                ),
              ),
            )
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={acceptAttrFor('artwork')}
          hidden
          onChange={(event) => void upload(event.target.files)}
        />
        <button
          type="button"
          className="jx-upload"
          onClick={() => inputRef.current?.click()}
          disabled={busy === 'upload' || media.length >= maxImagesFor('artwork')}
        >
          {mode === 'image' ? <SwapIcon /> : <VideoIcon />}
          {busy === 'upload' ? (
            <span>Uploading…</span>
          ) : mode === 'image' ? (
            <span>
              Change upload
              <br />
              max {megabytes(MAX_UPLOAD_BYTES)}
            </span>
          ) : (
            <span title={`Clips up to ${megabytes(MAX_VIDEO_BYTES)}`}>
              Upload {clips.length}/{maxImagesFor('artwork')}
            </span>
          )}
        </button>
      </div>

      <div className="jx-share__actions">
        <button type="button" className="jx-sbtn" onClick={onCustomize} title="Colours, frame and handle are set in the card editor">
          <CustomizeIcon /> Customize
        </button>
        <span className="jx-spacer" />
        {mode === 'video' ? (
          <button
            type="button"
            className="jx-sbtn"
            disabled={!state || busy !== null || !video.supported}
            onClick={() => void run('mp4')}
          >
            <DownloadIcon /> {busy === 'mp4' ? `Recording ${Math.round(progress * 100)}%` : 'Export Video'}
          </button>
        ) : (
          <>
            <button type="button" className="jx-sbtn" disabled={!state || busy !== null} onClick={() => void run('png')}>
              <DownloadIcon /> {busy === 'png' ? 'Rendering…' : 'Download'}
            </button>
            {canCopyImage() ? (
              <button type="button" className="jx-sbtn" disabled={!state || busy !== null} onClick={() => void run('copy')}>
                <CopyIcon /> {busy === 'copy' ? 'Copying…' : 'Copy'}
              </button>
            ) : null}
          </>
        )}
      </div>

      {limit ? (
        <LimitDialog
          status={limit}
          onClose={() => setLimit(null)}
          onSeePlans={() => {
            setLimit(null);
            navigate(PRICING_PATH);
          }}
        />
      ) : null}
    </Overlay>
  );
}
