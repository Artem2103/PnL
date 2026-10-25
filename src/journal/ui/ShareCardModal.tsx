import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArtworkState, BrandState, CardState, DisplayState, StudioClip, StudioState } from '../../types';
import { CardPreview } from '../../components/CardPreview';
import { LimitDialog } from '../../components/LimitDialog';
import type { BackgroundInfo } from '../../components/ControlPanel';
import { canCopyImage, canShareFiles, copyCardToClipboard, downloadCard, shareCard, shareMessage } from '../../lib/share';
import { ACCEPT_ATTR, describeMedia, MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES } from '../../lib/images';
import {
  addMedia,
  deleteMedia,
  listMedia,
  maxImagesFor,
  releaseThumbnails,
  type MediaSummary,
} from '../../lib/library';
import { downloadCardVideo, videoSupport } from '../../lib/video';
import { claimExport, type ExportFormat, type PlanStatus } from '../../lib/billing';
import { PRICING_PATH, navigate } from '../../lib/route';
import { CARD } from '../../lib/render';
import { DEFAULT_SCENE_ID, SCENES, drawScene, sceneById } from '../../lib/canvas/scenes';
import { slugify } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useCloudCard } from '../../lib/useCloudCard';
import { timeline } from '../../lib/studio/frame';
import { downloadStudio } from '../../lib/studio/compose';
import { addSound, listSounds, type SoundSummary } from '../../lib/studio/sounds';
import { journalCardState, type ShareSubject } from '../shareCard';
import { Overlay } from './Overlay';
import { CustomizeDialog } from './CustomizeDialog';
import { StudioPreview, type StudioPlayer } from './StudioPreview';
import { AdvancedPanel, Range, clock, percent, secs } from './AdvancedPanel';
import {
  AdvancedIcon,
  CloseIcon,
  CopyIcon,
  CustomizeIcon,
  DownloadIcon,
  ImageIcon,
  PauseIcon,
  PlayIcon,
  ShareIcon,
  SwapIcon,
  TrashIcon,
  VideoIcon,
} from './icons';

const SCALES = [1, 2, 3] as const;
/** The Video side takes clips only, the Image side photos only. */
const ACCEPT_VIDEO = 'video/mp4,video/quicktime,video/webm';
const THUMB_W = 118;
const THUMB_H = 80;

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

/** A clip placed on the timeline from the library, all of it up to 30 s. */
function clipFrom(item: Pick<MediaSummary, 'id' | 'duration'>, from?: Partial<StudioClip>): StudioClip {
  return {
    id: newId(),
    mediaId: item.id,
    start: 0,
    length: Math.max(0.5, Math.min(item.duration || 10, 30)),
    volume: 1,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    ...from,
  };
}

/**
 * The share sheet: the existing PnL card with every editor control, laid out
 * like the reference — and, on the Video side, a small studio: the card over
 * one or more clips in a 16:9, 4:3, 1:1 or card-shaped frame, sounds laid
 * under it, exported as one MP4.
 *
 * The card's design is the account's own card (`useCloudCard`), so anything
 * changed here is what the editor shows, and the other way round. Only the
 * numbers come from the journal.
 */
export function ShareCardModal({
  userId,
  subject,
  currency,
  onClose,
}: {
  userId: string;
  subject: ShareSubject;
  currency: string;
  onClose: () => void;
}) {
  const { librarySyncedAt } = useAuth();
  const { state: design, setState: setDesign } = useCloudCard(userId);
  const [mode, setMode] = useState<'image' | 'video'>('image');
  const [advanced, setAdvanced] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [media, setMedia] = useState<MediaSummary[]>([]);
  const [sounds, setSounds] = useState<SoundSummary[]>([]);
  const [busy, setBusy] = useState<null | ExportFormat | 'upload'>(null);
  const [progress, setProgress] = useState(0);
  const [scale, setScale] = useState(2);
  const [note, setNote] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [limit, setLimit] = useState<PlanStatus | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [background, setBackground] = useState<BackgroundInfo | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaSummary[]>([]);
  const playerRef = useRef<StudioPlayer>(null);
  const video = useMemo(videoSupport, []);

  const say = useCallback((text: string, tone: 'info' | 'error' = 'info') => setNote({ text, tone }), []);

  /* ---------------------------------------------------------- library */

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

  const refreshSounds = useCallback(() => {
    void listSounds(userId).then(setSounds, () => setSounds([]));
  }, [userId]);
  useEffect(refreshSounds, [refreshSounds]);

  const images = media.filter((m) => m.kind === 'image');
  const clips = media.filter((m) => m.kind === 'video');

  // What the card's background is, for the editor controls (trim shows for a clip).
  useEffect(() => {
    const id = design.artwork.imageId;
    if (!id) {
      setBackground(null);
      return;
    }
    let cancelled = false;
    void describeMedia(id).then((info) => {
      if (!cancelled) setBackground(info ? { kind: info.kind, duration: info.duration } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [design.artwork.imageId]);

  /* ---------------------------------------------------------- edits */

  const patchDisplay = useCallback(
    (patch: Partial<DisplayState>) => setDesign((prev) => ({ ...prev, display: { ...prev.display, ...patch } })),
    [setDesign],
  );
  const patchBrand = useCallback(
    (patch: Partial<BrandState>) => setDesign((prev) => ({ ...prev, brand: { ...prev.brand, ...patch } })),
    [setDesign],
  );
  const patchArtwork = useCallback(
    (patch: Partial<ArtworkState>) => setDesign((prev) => ({ ...prev, artwork: { ...prev.artwork, ...patch } })),
    [setDesign],
  );
  const setAvatarId = useCallback((avatarId: string | null) => setDesign((prev) => ({ ...prev, avatarId })), [setDesign]);
  const patchStudio = useCallback(
    (patch: Partial<StudioState>) => setDesign((prev) => ({ ...prev, studio: { ...prev.studio, ...patch } })),
    [setDesign],
  );
  const patchClip = useCallback(
    (id: string, patch: Partial<StudioClip>) =>
      setDesign((prev) => ({
        ...prev,
        studio: { ...prev.studio, clips: prev.studio.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) },
      })),
    [setDesign],
  );

  // The card the journal shares: the design, with the numbers from the journal.
  const state = useMemo(() => journalCardState(design, subject, currency), [currency, design, subject]);
  // Photos belong to the Image side and clips to the Video side. A card whose
  // background is a clip shows the house sky here instead.
  const ownIsClip = background?.kind === 'video' || clips.some((m) => m.id === design.artwork.imageId);
  const imageState = useMemo(
    () =>
      ownIsClip
        ? { ...state, artwork: { ...state.artwork, imageId: null, sceneId: state.artwork.sceneId ?? DEFAULT_SCENE_ID } }
        : state,
    [ownIsClip, state],
  );
  const studio = design.studio;
  const total = timeline(studio.clips).total;

  // Opening the Video side with an empty timeline starts it from the card's own clip.
  useEffect(() => {
    if (mode !== 'video' || studio.clips.length) return;
    const own = clips.find((m) => m.id === design.artwork.imageId);
    if (!own) return;
    patchStudio({
      clips: [
        clipFrom(own, {
          start: design.artwork.clipStart,
          length: Math.max(0.5, Math.min(design.artwork.clipLength, (own.duration || 30) - design.artwork.clipStart)),
          volume: design.artwork.muteAudio ? 0 : 1,
          zoom: design.artwork.zoom,
          offsetX: design.artwork.offsetX,
          offsetY: design.artwork.offsetY,
        }),
      ],
    });
  }, [mode, clips.length]);

  /* ---------------------------------------------------------- exports */

  const gate = useCallback(
    async (card: CardState, format: ExportFormat) => {
      try {
        const decision = await claimExport(card, format);
        if (!decision.allowed) setLimit(decision.status);
        return decision.allowed;
      } catch (error) {
        say(error instanceof Error ? error.message : 'Could not check your plan.', 'error');
        return false;
      }
    },
    [say],
  );

  const runImage = async (format: 'png' | 'copy' | 'share') => {
    setBusy(format);
    setNote(null);
    try {
      if (format === 'copy') {
        // Started inside the click: Safari only lets the clipboard be written
        // from there, so the plan check rides along in the write.
        const allowed = gate(imageState, 'copy');
        try {
          await copyCardToClipboard(
            imageState,
            scale,
            allowed.then((ok) => {
              if (!ok) throw new Error('Export not allowed.');
            }),
          );
          say('Card copied to clipboard.');
        } catch (error) {
          if (await allowed) throw error;
        }
        return;
      }
      if (!(await gate(imageState, format))) return;
      if (format === 'share') {
        const outcome = await shareCard(imageState, scale);
        const { message, tone } = shareMessage(outcome);
        if (outcome !== 'shared') say(message, tone);
        return;
      }
      await downloadCard(imageState, scale);
      say('PNG downloaded.');
    } catch (error) {
      say(error instanceof Error ? error.message : 'Export failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const runVideo = async () => {
    if (!studio.clips.length) return;
    setBusy('mp4');
    setNote(null);
    setProgress(0);
    const wasPlaying = playing;
    setPlaying(false);
    try {
      if (!(await gate(state, 'mp4'))) return;
      const only = studio.clips[0]!;
      if (studio.aspect === 'card' && studio.clips.length === 1 && !studio.tracks.length) {
        // One clip behind the card and nothing added: the editor's own
        // frame-exact export, unchanged.
        const result = await downloadCardVideo(
          {
            ...state,
            artwork: {
              ...state.artwork,
              imageId: only.mediaId,
              sceneId: null,
              clipStart: only.start,
              clipLength: only.length,
              muteAudio: only.volume === 0,
              zoom: only.zoom,
              offsetX: only.offsetX,
              offsetY: only.offsetY,
            },
          },
          { scale: 2, onProgress: setProgress },
        );
        say(`Video downloaded — ${result.duration.toFixed(1)} s, ${result.fps} fps.`);
      } else {
        const title = state.mode === 'trade' ? state.trade.symbol : state.period.title;
        const result = await downloadStudio(state, `${slugify(title, 'pnl')}-pnl`, { onProgress: setProgress });
        say(`Video downloaded — ${result.duration.toFixed(1)} s, ${result.width}×${result.height}.`);
      }
    } catch (error) {
      say(error instanceof Error ? error.message : 'Video export failed.', 'error');
    } finally {
      setBusy(null);
      setProgress(0);
      setPlaying(wasPlaying);
    }
  };

  /* ---------------------------------------------------------- uploads */

  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const isClip = file.type.startsWith('video/');
    if (isClip !== (mode === 'video')) {
      say(mode === 'video' ? 'The Video side takes clips. Add photos on the Image side.' : 'The Image side takes photos. Add clips on the Video side.', 'error');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setBusy('upload');
    setNote(null);
    try {
      // The same library the editor uses: the file is one of the account's backgrounds.
      const record = await addMedia(file, 'artwork', userId, (error) => {
        if (error) say(error.message, 'error');
        void refresh();
      });
      await refresh();
      if (record.kind === 'video') {
        const item = { id: record.id, duration: record.duration ?? 10 };
        patchStudio({ clips: [clipFrom(item)] });
      } else {
        patchArtwork({ imageId: record.id, sceneId: null });
      }
    } catch (error) {
      say(error instanceof Error ? error.message : 'Upload failed.', 'error');
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const addSoundFile = async (file: File) => {
    try {
      const sound = await addSound(userId, file);
      refreshSounds();
      return sound;
    } catch (error) {
      say(error instanceof Error ? error.message : 'That sound could not be added.', 'error');
      return null;
    }
  };

  // One clip per video: picking another replaces it.
  const pickClip = (item: MediaSummary) => {
    patchStudio({ clips: [clipFrom(item)] });
    playerRef.current?.seek(0);
  };

  const removeMedia = async (item: MediaSummary) => {
    try {
      await deleteMedia(item.id);
      if (design.artwork.imageId === item.id) patchArtwork({ imageId: null });
      if (studio.clips.some((c) => c.mediaId === item.id)) patchStudio({ clips: [] });
      await refresh();
    } catch (error) {
      say(error instanceof Error ? error.message : 'That file could not be deleted.', 'error');
    }
  };

  const openUpload = () => {
    if (media.length >= maxImagesFor('artwork')) {
      say(
        `Your library is full (${maxImagesFor('artwork')} photos and clips). Delete one with its × to make room.`,
        'error',
      );
      return;
    }
    inputRef.current?.click();
  };

  /* ---------------------------------------------------------- view */

  const isSceneSelected = (id: string) => !imageState.artwork.imageId && imageState.artwork.sceneId === id;

  // The wheel zooms the background, as dragging moves it.
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!design.artwork.imageId) return;
    const factor = event.deltaY < 0 ? 1.06 : 1 / 1.06;
    patchArtwork({ zoom: Math.min(3, Math.max(1, design.artwork.zoom * factor)) });
  };

  const clip = studio.clips[0] ?? null;
  const clipDuration = clips.find((m) => m.id === clip?.mediaId)?.duration ?? 0;

  return (
    <Overlay
      label="Share card"
      className={`jx-share${mode === 'video' ? ' jx-share--video' : ''}${mode === 'video' && advanced ? ' jx-share--advanced' : ''}`}
      onClose={onClose}
    >
      <button type="button" className="jx-sr" onClick={onClose} aria-label="Close">
        <CloseIcon />
      </button>

      {mode === 'image' ? (
        <div className="jx-share__card" onWheel={onWheel}>
          <CardPreview state={imageState} canvasRef={canvasRef} patchArtwork={patchArtwork} playing />
        </div>
      ) : (
        <div className="jx-share__card jx-share__card--studio">
          <StudioPreview
            ref={playerRef}
            state={state}
            onClip={patchClip}
            playing={playing}
            onPlaying={setPlaying}
            onTime={setTime}
          />
        </div>
      )}

      <div className="jx-share__row">
        <div className="jx-segment" role="group" aria-label="Format">
          <button type="button" className={mode === 'image' ? 'is-active' : ''} aria-pressed={mode === 'image'} onClick={() => setMode('image')}>
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

        <span className="jx-spacer" />

        {mode === 'video' ? (
          <>
            <button
              type="button"
              className="jx-iconbtn"
              onClick={() => patchStudio({ clips: [] })}
              disabled={!studio.clips.length}
              aria-label="Remove the clip"
              title="Remove the clip"
            >
              <TrashIcon />
            </button>
            <button
              type="button"
              className={`jx-sbtn jx-sbtn--pill${advanced ? ' is-on' : ''}`}
              onClick={() => setAdvanced((open) => !open)}
              aria-pressed={advanced}
            >
              <AdvancedIcon /> Advanced
            </button>
          </>
        ) : null}
      </div>

      {note ? (
        <p className={`jx-share__note${note.tone === 'error' ? ' is-error' : ''}`} role="status">
          {note.text}
        </p>
      ) : null}

      {mode === 'video' ? (
        <>
          <div className="jx-player">
            <button
              type="button"
              className="jx-player__play"
              onClick={() => setPlaying((value) => !value)}
              disabled={!clip}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <span>{clock(Math.min(time, total))}</span>
            <input
              className="jx-player__scrub"
              type="range"
              min={0}
              max={Math.max(0.1, total)}
              step={0.05}
              value={Math.min(time, total)}
              onChange={(event) => playerRef.current?.seek(Number(event.target.value))}
              disabled={!clip}
              aria-label="Position"
              style={{ ['--fill' as string]: `${total ? (Math.min(time, total) / total) * 100 : 0}%` }}
            />
            <span>{clock(total)}</span>
          </div>
          {clip ? (
            <div className="jx-trim">
              <Range
                label="Start at"
                value={clip.start}
                min={0}
                max={Math.max(0, clipDuration - 0.5)}
                step={0.1}
                format={secs}
                onChange={(start) =>
                  patchClip(clip.id, { start, length: Math.min(clip.length, Math.max(0.5, clipDuration - start)) })
                }
              />
              <Range
                label="Length"
                value={clip.length}
                min={0.5}
                max={Math.max(0.5, Math.min(30, clipDuration - clip.start))}
                step={0.1}
                format={secs}
                onChange={(length) => patchClip(clip.id, { length })}
              />
              <Range
                label="Clip sound"
                value={clip.volume}
                min={0}
                max={1}
                step={0.01}
                format={percent}
                onChange={(volume) => patchClip(clip.id, { volume })}
              />
            </div>
          ) : null}
          {advanced ? (
            <AdvancedPanel
              studio={studio}
              total={total}
              sounds={sounds}
              onStudio={patchStudio}
              onAddSound={addSoundFile}
              onError={(message) => say(message, 'error')}
            />
          ) : null}
        </>
      ) : null}

      <div className="jx-strip">
        <div className="jx-strip__thumbs">
          {mode === 'image' ? (
            <>
              {SCENES.map((scene) => (
                <button
                  key={scene.id}
                  type="button"
                  className={`jx-thumb${isSceneSelected(scene.id) ? ' is-selected' : ''}`}
                  onClick={() => patchArtwork({ sceneId: scene.id, imageId: null })}
                  aria-pressed={isSceneSelected(scene.id)}
                  title={scene.name}
                >
                  <SceneThumb sceneId={scene.id} />
                </button>
              ))}
              {images.map((item) => (
                <div key={item.id} className="jx-thumbwrap">
                  <button
                    type="button"
                    className={`jx-thumb${design.artwork.imageId === item.id ? ' is-selected' : ''}`}
                    onClick={() => patchArtwork({ imageId: item.id, sceneId: null })}
                    aria-pressed={design.artwork.imageId === item.id}
                    title={item.name}
                  >
                    <img src={item.url} alt="" loading="lazy" />
                  </button>
                  <button
                    type="button"
                    className="jx-thumb__delete"
                    onClick={() => void removeMedia(item)}
                    aria-label={`Delete ${item.name}`}
                    title="Delete from your library"
                  >
                    ×
                  </button>
                </div>
              ))}
            </>
          ) : (
            clips.map((item) => {
              const used = studio.clips.some((c) => c.mediaId === item.id);
              return (
                <div key={item.id} className="jx-thumbwrap">
                  <button
                    type="button"
                    className={`jx-thumb${used ? ' is-selected' : ''}`}
                    onClick={() => pickClip(item)}
                    title={item.name}
                  >
                    {item.posterUrl ? (
                      <img src={item.posterUrl} alt="" loading="lazy" />
                    ) : (
                      <video src={item.url} muted playsInline preload="metadata" />
                    )}
                    <span className="jx-thumb__badge">{clock(item.duration)}</span>
                  </button>
                  <button
                    type="button"
                    className="jx-thumb__delete"
                    onClick={() => void removeMedia(item)}
                    aria-label={`Delete ${item.name}`}
                    title="Delete from your library"
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={mode === 'video' ? ACCEPT_VIDEO : ACCEPT_ATTR}
          hidden
          onChange={(event) => void upload(event.target.files)}
        />
        <button
          type="button"
          className="jx-upload"
          onClick={openUpload}
          disabled={busy === 'upload'}
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
        <button type="button" className="jx-sbtn" onClick={() => setCustomize(true)}>
          <CustomizeIcon /> Customize
        </button>
        <span className="jx-spacer" />
        {mode === 'video' ? (
          <button
            type="button"
            className="jx-sbtn"
            disabled={!studio.clips.length || busy !== null || !video.supported}
            onClick={() => void runVideo()}
          >
            <DownloadIcon /> {busy === 'mp4' ? `Exporting ${Math.round(progress * 100)}%` : 'Export Video'}
          </button>
        ) : (
          <>
            <div className="jx-segment jx-segment--small" role="group" aria-label="Resolution">
              {SCALES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={scale === s ? 'is-active' : ''}
                  aria-pressed={scale === s}
                  onClick={() => setScale(s)}
                  title={`${CARD.width * s}×${CARD.height * s}`}
                >
                  {s}×
                </button>
              ))}
            </div>
            <button type="button" className="jx-sbtn" disabled={busy !== null} onClick={() => void runImage('png')}>
              <DownloadIcon /> {busy === 'png' ? 'Rendering…' : 'Download'}
            </button>
            {canCopyImage() ? (
              <button type="button" className="jx-sbtn" disabled={busy !== null} onClick={() => void runImage('copy')}>
                <CopyIcon /> {busy === 'copy' ? 'Copying…' : 'Copy'}
              </button>
            ) : null}
            {canShareFiles() ? (
              <button type="button" className="jx-sbtn" disabled={busy !== null} onClick={() => void runImage('share')}>
                <ShareIcon size={17} /> Share
              </button>
            ) : null}
          </>
        )}
      </div>

      {customize ? (
        <CustomizeDialog
          state={mode === 'image' ? imageState : state}
          background={mode === 'image' && ownIsClip ? null : background}
          isTrade={state.mode === 'trade'}
          patchDisplay={patchDisplay}
          patchBrand={patchBrand}
          patchArtwork={patchArtwork}
          setAvatarId={setAvatarId}
          onError={(message) => say(message, 'error')}
          onClose={() => setCustomize(false)}
        />
      ) : null}

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
