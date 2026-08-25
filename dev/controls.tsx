/**
 * Dev-only: the editor panel and a live card, with no account in front of it.
 *
 * The studio itself sits behind the Supabase gate, so without credentials
 * there is no way to look at a control — including the ones added on
 * 2026-08-25, the accent picker and the text-tone switch. This mounts the real
 * `ControlPanel` against local state and paints the real renderer beside it, so
 * the panel can be driven and the card watched without a project, a sign-up or
 * a network.
 *
 * It is wrapped in `AuthProvider` because `ImagePicker` calls `useAuth`, which
 * throws outside one. With no Supabase client configured the provider settles
 * on "no session" immediately, which is all the picker needs to render — the
 * media roster will be empty, and uploading is the one thing this page cannot
 * exercise. Everything else is the shipping component, not a copy of it.
 *
 * Not part of the build: Vite's only entry is index.html.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ControlPanel } from '../src/components/ControlPanel';
import { AuthProvider } from '../src/lib/auth';
import { createDefaultState } from '../src/lib/defaults';
import { ensureFonts } from '../src/lib/fonts';
import { prepareAssets, renderToCanvas } from '../src/lib/render';
import type { CardState, RenderAssets } from '../src/types';
import '../src/styles/global.css';

function Playground() {
  const [state, setState] = useState<CardState>(createDefaultState);
  const [assets, setAssets] = useState<RenderAssets>({ artwork: null, avatar: null, logo: null });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    void ensureFonts().then(() => prepareAssets(state)).then((next) => {
      if (live) setAssets(next);
    });
    return () => {
      live = false;
    };
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) renderToCanvas(canvas, state, assets, 2);
  }, [state, assets]);

  // The panel takes one patch function per slice of the model.
  const props = useMemo(
    () => ({
      setMode: (mode: CardState['mode']) => setState((s) => ({ ...s, mode })),
      patchTrade: (patch: Partial<CardState['trade']>) =>
        setState((s) => ({ ...s, trade: { ...s.trade, ...patch } })),
      patchPeriod: (patch: Partial<CardState['period']>) =>
        setState((s) => ({ ...s, period: { ...s.period, ...patch } })),
      patchBrand: (patch: Partial<CardState['brand']>) =>
        setState((s) => ({ ...s, brand: { ...s.brand, ...patch } })),
      patchDisplay: (patch: Partial<CardState['display']>) =>
        setState((s) => ({ ...s, display: { ...s.display, ...patch } })),
      patchArtwork: (patch: Partial<CardState['artwork']>) =>
        setState((s) => ({ ...s, artwork: { ...s.artwork, ...patch } })),
      setAvatarId: (avatarId: string | null) => setState((s) => ({ ...s, avatarId })),
      setLogoId: (logoId: string | null) => setState((s) => ({ ...s, logoId })),
      onError: (message: string) => console.warn('[controls]', message),
    }),
    [],
  );

  return (
    <div className="dev-playground">
      <div className="dev-playground__card">
        <canvas ref={canvasRef} width={1680} height={1140} />
        <pre>{JSON.stringify(state.display, null, 1)}</pre>
      </div>
      <div className="dev-playground__panel">
        <ControlPanel state={state} background={null} {...props} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <Playground />
  </AuthProvider>,
);
