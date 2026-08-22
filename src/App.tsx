import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ArtworkState,
  BrandState,
  CardMode,
  CardState,
  DisplayState,
  PeriodState,
  TradeState,
} from './types';
import { CardPreview } from './components/CardPreview';
import { ControlPanel } from './components/ControlPanel';
import { createDefaultState, loadState, saveState } from './lib/defaults';
import {
  canCopyImage,
  canShareFiles,
  copyCardToClipboard,
  downloadCard,
  shareCard,
} from './lib/share';
import { CARD } from './lib/render';
import { checkExportMatchesPreview } from './lib/selftest';

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

export default function App() {
  const [state, setState] = useState<CardState>(() => loadState());
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState<null | 'download' | 'copy' | 'share'>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  // Persist, debounced — typing in a text field shouldn't hammer localStorage.
  useEffect(() => {
    const timer = setTimeout(() => saveState(state), 400);
    return () => clearTimeout(timer);
  }, [state]);

  const setMode = useCallback((mode: CardMode) => setState((prev) => ({ ...prev, mode })), []);
  const patchTrade = useCallback(
    (patch: Partial<TradeState>) => setState((prev) => ({ ...prev, trade: { ...prev.trade, ...patch } })),
    [],
  );
  const patchPeriod = useCallback(
    (patch: Partial<PeriodState>) =>
      setState((prev) => ({ ...prev, period: { ...prev.period, ...patch } })),
    [],
  );
  const patchBrand = useCallback(
    (patch: Partial<BrandState>) => setState((prev) => ({ ...prev, brand: { ...prev.brand, ...patch } })),
    [],
  );
  const patchDisplay = useCallback(
    (patch: Partial<DisplayState>) =>
      setState((prev) => ({ ...prev, display: { ...prev.display, ...patch } })),
    [],
  );
  const patchArtwork = useCallback(
    (patch: Partial<ArtworkState>) =>
      setState((prev) => ({ ...prev, artwork: { ...prev.artwork, ...patch } })),
    [],
  );
  const setAvatarId = useCallback(
    (avatarId: string | null) => setState((prev) => ({ ...prev, avatarId })),
    [],
  );
  const setLogoId = useCallback(
    (logoId: string | null) => setState((prev) => ({ ...prev, logoId })),
    [],
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleDownload();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDownload]);

  // Dev-only hook used to verify the export matches the preview pixel-for-pixel.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const globalScope = window as unknown as Record<string, unknown>;
    globalScope.__pnlCheckExport = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return { ok: false, note: 'No preview canvas mounted.' };
      return checkExportMatchesPreview(state, canvas);
    };
    return () => {
      delete globalScope.__pnlCheckExport;
    };
  }, [state]);

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
      </header>

      <main className="layout">
        <aside className="layout__controls" aria-label="Card settings">
          <ControlPanel
            state={state}
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
            <CardPreview state={state} canvasRef={canvasRef} />

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
                  className="btn btn--primary"
                  onClick={() => void handleDownload()}
                  disabled={busy !== null}
                >
                  {busy === 'download' ? 'Rendering…' : 'Download PNG'}
                </button>
              </div>
            </div>

            <p className="stage__note">
              The download is painted by the same renderer as this preview — what you see is exactly
              what lands in the PNG. <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd> exports.
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
