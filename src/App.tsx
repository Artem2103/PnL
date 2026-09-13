import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArtworkState,
  BrandState,
  CardMode,
  DisplayState,
  PeriodState,
  TradeState,
} from './types';
import { CardPreview } from './components/CardPreview';
import { ControlPanel, type BackgroundInfo } from './components/ControlPanel';
import { createDefaultState } from './lib/defaults';
import { useCloudCard, type CardSyncStatus } from './lib/useCloudCard';
import {
  canCopyImage,
  canShareFiles,
  shareMessage,
  copyCardToClipboard,
  downloadCard,
  shareCard,
} from './lib/share';
import { CARD } from './lib/render';
import { describeMedia, loadMedia } from './lib/images';
import { downloadCardVideo, resolveClip, videoScaleFor, videoSupport } from './lib/video';
import { checkExportMatchesPreview } from './lib/selftest';
import { useAuth } from './lib/auth';
import { ProfileMenu } from './components/ProfileMenu';

type ToastTone = 'info' | 'error';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const SCALES = [
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 3, label: '3×' },
];

/**
 * Now that the card is stored remotely, whether it *got* there is information
 * the person editing it needs. Silence would be indistinguishable from a broken
 * save until the next time they opened the app on another device.
 */
const SYNC_LABEL: Record<CardSyncStatus, string> = {
  loading: 'Opening…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved',
  local: 'This browser only',
};

export default function App() {
  const { user, userId, mode: authMode, signOut } = useAuth();
  // The card lives in the account now. This still paints from the local cache
  // on the first frame; the reconciliation lands behind it.
  const { state, setState, status: cardStatus, error: cardError } = useCloudCard(userId ?? '');
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState<null | 'download' | 'copy' | 'share' | 'video'>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [background, setBackground] = useState<BackgroundInfo | null>(null);
  const [playing, setPlaying] = useState(true);
  // Preview only, and not saved: every visit starts silent.
  const [soundOn, setSoundOn] = useState(false);
  const [progress, setProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const video = useMemo(videoSupport, []);

  const isVideoBackground = background?.kind === 'video';
  const clip = resolveClip(background?.duration ?? 0, state.artwork.clipStart, state.artwork.clipLength);
  const videoScale = videoScaleFor(scale);

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  // A failed save is worth saying out loud once: the edits are safe in this
  // browser, but "saved" is exactly the thing the person is assuming.
  useEffect(() => {
    if (cardStatus === 'error' && cardError) notify(cardError, 'error');
  }, [cardError, cardStatus, notify]);

  // What the chosen background actually is. The renderer shares this cache, so
  // resolving it here costs no second decode.
  //
  // The record is read first and the decode second, because they can disagree:
  // a browser will not decode video in a window that is behind another one, and
  // `loadMedia` then answers null. Driving the UI off that answer meant picking
  // a clip with the window covered hid the trim controls and the MP4 button
  // altogether — the export looked missing rather than postponed. The record
  // knows it is a clip either way; only the pixels have to wait.
  useEffect(() => {
    const id = state.artwork.imageId;
    if (!id) {
      setBackground(null);
      return;
    }
    let cancelled = false;
    let decoded = false;
    void describeMedia(id).then((info) => {
      // The decode can win the race on a cache hit; its duration is measured
      // rather than remembered, so it is not overwritten by the record's.
      if (cancelled || decoded) return;
      setBackground(info ? { kind: info.kind, duration: info.duration } : null);
    });
    void loadMedia(id).then((media) => {
      if (cancelled) return;
      decoded = true;
      if (media) setBackground({ kind: media.kind, duration: media.duration });
      setPlaying(true);
    });
    return () => {
      cancelled = true;
    };
  }, [state.artwork.imageId]);

  const setMode = useCallback((mode: CardMode) => setState((prev) => ({ ...prev, mode })), [setState]);
  const patchTrade = useCallback(
    (patch: Partial<TradeState>) => setState((prev) => ({ ...prev, trade: { ...prev.trade, ...patch } })),
    [setState],
  );
  const patchPeriod = useCallback(
    (patch: Partial<PeriodState>) =>
      setState((prev) => ({ ...prev, period: { ...prev.period, ...patch } })),
    [setState],
  );
  const patchBrand = useCallback(
    (patch: Partial<BrandState>) => setState((prev) => ({ ...prev, brand: { ...prev.brand, ...patch } })),
    [setState],
  );
  const patchDisplay = useCallback(
    (patch: Partial<DisplayState>) =>
      setState((prev) => ({ ...prev, display: { ...prev.display, ...patch } })),
    [setState],
  );
  const patchArtwork = useCallback(
    (patch: Partial<ArtworkState>) =>
      setState((prev) => ({ ...prev, artwork: { ...prev.artwork, ...patch } })),
    [setState],
  );
  const setAvatarId = useCallback(
    (avatarId: string | null) => setState((prev) => ({ ...prev, avatarId })),
    [setState],
  );
  const setLogoId = useCallback(
    (logoId: string | null) => setState((prev) => ({ ...prev, logoId })),
    [setState],
  );

  const handleDownload = useCallback(async () => {
    setBusy('download');
    try {
      await downloadCard(state, scale);
      notify('PNG downloaded.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed.', 'error');
    } finally {
      setBusy(null);
    }
  }, [notify, scale, state]);

  const handleCopy = useCallback(async () => {
    setBusy('copy');
    try {
      await copyCardToClipboard(state, scale);
      notify('Card copied to clipboard.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Copy failed.', 'error');
    } finally {
      setBusy(null);
    }
  }, [notify, scale, state]);

  const handleDownloadVideo = useCallback(async () => {
    setBusy('video');
    setProgress(0);
    // The export and the preview share one decoder and one GPU. Holding the
    // preview on its current frame while the file is made gives the export
    // the whole machine, and spares the person a stuttering preview next to
    // a progress bar.
    const wasPlaying = playing;
    setPlaying(false);
    try {
      const result = await downloadCardVideo(state, {
        scale,
        onProgress: setProgress,
      });
      const how =
        result.recorder === 'frame-exact'
          ? `${result.fps} fps, every frame`
          : `recorded live at ${result.fps} fps`;
      notify(
        `${result.extension.toUpperCase()} downloaded — ${result.duration.toFixed(1)} s, ${how}, ` +
          `in ${result.elapsed.toFixed(1)} s.`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Video export failed.', 'error');
    } finally {
      setBusy(null);
      setProgress(0);
      setPlaying(wasPlaying);
    }
  }, [notify, playing, scale, state]);

  const handleShare = useCallback(async () => {
    setBusy('share');
    try {
      const outcome = await shareCard(state, scale);
      // Only 'shared' is worth a cheerful toast; the rest each mean something
      // different, and reporting them all as "cancelled" was why a share that
      // never opened looked like one the person had called off.
      const { message, tone } = shareMessage(outcome);
      if (outcome !== 'shared') notify(message, tone);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Sharing failed.', 'error');
    } finally {
      setBusy(null);
    }
  }, [notify, scale, state]);

  // Bound once. `handleDownload` is rebuilt on every keystroke, and rebinding a
  // window listener each time is work no keystroke should be paying for.
  const downloadRef = useRef(handleDownload);
  downloadRef.current = handleDownload;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void downloadRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Dev-only hook used to verify the export matches the preview pixel-for-pixel.
  // It reads the live state through a ref so it is installed once, rather than
  // being torn down and rebuilt on every keystroke.
  const liveRef = useRef({ state, playing });
  liveRef.current = { state, playing };

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const globalScope = window as unknown as Record<string, unknown>;
    globalScope.__pnlCheckExport = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return { ok: false, note: 'No preview canvas mounted.' };
      // The check freezes the clip itself, but the preview loop would restart
      // it on the next frame unless playback is stopped here first.
      const wasPlaying = liveRef.current.playing;
      setPlaying(false);
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        return await checkExportMatchesPreview(liveRef.current.state, canvas);
      } finally {
        if (wasPlaying) setPlaying(true);
      }
    };
    return () => {
      delete globalScope.__pnlCheckExport;
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <div>
            <h1>PnL Card Studio</h1>
            <p>Share cards, rendered in your browser.</p>
          </div>
        </div>
        <div className="topbar__actions">
          <span className={`syncdot syncdot--${cardStatus}`} aria-live="polite">
            <span className="syncdot__mark" aria-hidden="true" />
            {SYNC_LABEL[cardStatus]}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              setState(createDefaultState());
              notify('Reset to the sample card.');
            }}
          >
            Reset
          </button>
          <ProfileMenu
            user={user}
            mode={authMode}
            onSignOut={() => {
              void signOut().catch((error: unknown) =>
                notify(error instanceof Error ? error.message : 'Log out failed.', 'error'),
              );
            }}
          />
        </div>
      </header>

      {/* Says what "This browser only" in the topbar actually costs, and where
          the two variables go. Not dismissible: it is the whole difference
          between this and the signed-in app, and it disappears on its own the
          moment the credentials are there. */}
      {authMode === 'local' ? (
        <p className="localnote" role="status">
          <strong>Accounts are off.</strong> Your card and your images are saved in this browser and
          nowhere else — they will not follow you to another device, and clearing site data loses
          them. To turn accounts back on, put <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code> and restart the dev server.
        </p>
      ) : null}

      <main className="layout">
        <aside className="layout__controls" aria-label="Card settings">
          <ControlPanel
            state={state}
            background={background}
            setMode={setMode}
            patchTrade={patchTrade}
            patchPeriod={patchPeriod}
            patchBrand={patchBrand}
            patchDisplay={patchDisplay}
            patchArtwork={patchArtwork}
            setAvatarId={setAvatarId}
            setLogoId={setLogoId}
            onError={(message) => notify(message, 'error')}
          />
        </aside>

        <section className="layout__stage" aria-label="Preview and export">
          <div className="stage__inner">
            <CardPreview
              state={state}
              canvasRef={canvasRef}
              patchArtwork={patchArtwork}
              playing={playing}
              soundOn={soundOn}
            />

            {isVideoBackground ? (
              <div className="clipbar">
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => setPlaying((value) => !value)}
                >
                  {playing ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => setSoundOn((value) => !value)}
                  aria-pressed={soundOn}
                >
                  {soundOn ? 'Sound off' : 'Sound on'}
                </button>
                <span className="clipbar__meta">
                  {clip.length.toFixed(1)} s clip · video {videoScale}× ·{' '}
                  {Math.round(CARD.width * videoScale)}×{Math.round(CARD.height * videoScale)}
                  {video.extension ? ` · ${video.extension.toUpperCase()}` : ''}
                </span>
                {busy === 'video' ? (
                  <span className="clipbar__progress" aria-live="polite">
                    <span style={{ width: `${Math.round(progress * 100)}%` }} />
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="exportbar">
              <div className="exportbar__scale" role="group" aria-label="Export resolution">
                {SCALES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`chip${scale === option.value ? ' is-active' : ''}`}
                    onClick={() => setScale(option.value)}
                    aria-pressed={scale === option.value}
                  >
                    {option.label}
                  </button>
                ))}
                <span className="exportbar__dims">
                  {Math.round(CARD.width * scale)}×{Math.round(CARD.height * scale)}
                </span>
              </div>

              <div className="exportbar__actions">
                {isVideoBackground && video.supported ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void handleDownloadVideo()}
                    disabled={busy !== null}
                    title={`Every frame of the ${clip.length.toFixed(1)} s window, at the clip's own frame rate`}
                  >
                    {busy === 'video'
                      ? `Recording ${Math.round(progress * 100)}%`
                      : `Download ${video.extension?.toUpperCase() ?? 'video'}`}
                  </button>
                ) : null}
                {canCopyImage() ? (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void handleCopy()}
                    disabled={busy !== null}
                  >
                    {busy === 'copy' ? 'Copying…' : 'Copy'}
                  </button>
                ) : null}
                {canShareFiles() ? (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void handleShare()}
                    disabled={busy !== null}
                  >
                    {busy === 'share' ? 'Sharing…' : 'Share'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={
                    isVideoBackground && video.supported ? 'btn btn--ghost' : 'btn btn--primary'
                  }
                  onClick={() => void handleDownload()}
                  disabled={busy !== null}
                >
                  {busy === 'download' ? 'Rendering…' : 'Download PNG'}
                </button>
              </div>
            </div>

            <p className="stage__note">
              {isVideoBackground ? (
                video.supported ? (
                  <>
                    One renderer paints the preview, the PNG and every video frame, so the card is
                    identical in all three. The video is built frame by frame from the clip's own
                    frames, not recorded off the screen: it keeps the clip's frame rate, the sound
                    stays in step, and it goes as fast as this machine can encode. The preview
                    pauses while it runs. The scale buttons set the PNG; video always records at{' '}
                    {videoScale}×, because anything smaller is smeared by the time a platform has
                    re-encoded it.
                  </>
                ) : (
                  <>
                    This browser cannot record video. The card still exports as a PNG of the frame
                    on screen — try Chrome, Edge or Safari for the clip.
                  </>
                )
              ) : (
                <>
                  The download is painted by the same renderer as this preview — what you see is
                  exactly what lands in the PNG. <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd> exports.
                </>
              )}
            </p>
          </div>
        </section>
      </main>

      <div className="toast-area" aria-live="polite">
        {toast ? <div className={`toast toast--${toast.tone}`}>{toast.message}</div> : null}
      </div>
    </div>
  );
}
