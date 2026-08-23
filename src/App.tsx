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
  copyCardToClipboard,
  downloadCard,
  shareCard,
} from './lib/share';
import { CARD } from './lib/render';
import { loadMedia } from './lib/images';
import { downloadCardVideo, resolveClip, videoScaleFor, videoSupport } from './lib/video';
import { checkExportMatchesPreview } from './lib/selftest';
import { useAuth } from './lib/auth';

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
  const { user, signOut } = useAuth();
  // The card lives in the account now. This still paints from the local cache
  // on the first frame; the reconciliation lands behind it.
  const { state, setState, status: cardStatus, error: cardError } = useCloudCard(user?.id ?? '');
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState<null | 'download' | 'copy' | 'share' | 'video'>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [background, setBackground] = useState<BackgroundInfo | null>(null);
  const [playing, setPlaying] = useState(true);
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
  useEffect(() => {
    const id = state.artwork.imageId;
    if (!id) {
      setBackground(null);
      return;
    }
    let cancelled = false;
    void loadMedia(id).then((media) => {
      if (cancelled) return;
      setBackground(media ? { kind: media.kind, duration: media.duration } : null);
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
    try {
      const result = await downloadCardVideo(state, {
        scale,
        onProgress: setProgress,
      });
      notify(`${result.extension.toUpperCase()} downloaded — ${result.duration.toFixed(1)} s.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Video export failed.', 'error');
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }, [notify, scale, state]);

  const handleShare = useCallback(async () => {
    setBusy('share');
    try {
      const shared = await shareCard(state, scale);
      if (!shared) notify('Sharing was cancelled.', 'info');
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
          {user?.email ? (
            <span className="topbar__email" title={user.email}>
              {user.email}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              void signOut().catch((error: unknown) =>
                notify(error instanceof Error ? error.message : 'Sign out failed.', 'error'),
              );
            }}
          >
            Sign out
          </button>
        </div>
      </header>

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
                    title={`Records ${clip.length.toFixed(1)} s in real time`}
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
                    identical in all three. Recording runs in real time — {clip.length.toFixed(1)} s
                    of clip takes {clip.length.toFixed(1)} s, and the tab has to stay in front while
                    it does. The scale buttons set the PNG; video always records at {videoScale}×,
                    because anything smaller is smeared by the time a platform has re-encoded it.
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
