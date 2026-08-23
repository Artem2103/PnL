import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArtworkState, CardState, RenderAssets } from '../types';
import { CARD, prepareAssets, renderToCanvas } from '../lib/render';
import { placeCover, panBy } from '../lib/canvas/placement';
import { onFontsChanged } from '../lib/fonts';
import { resolveClip } from '../lib/video';

/** Preview beyond 2× device pixels is invisible and costs real time. */
const MAX_PREVIEW_SCALE = 2;
/** Floor for the adaptive scale below: softer, still legible. */
const MIN_PREVIEW_SCALE = 1;
/** Frames slower than this mean the clip is visibly dropping. */
const SLOW_FRAME_MS = 24;
/** Under this there is headroom to give the pixels back. */
const FAST_FRAME_MS = 18;
/** Quality may only move this often, so it cannot oscillate. */
const QUALITY_SETTLE_MS = 1500;

/** `requestVideoFrameCallback` — Chrome, Edge and Safari; absent on Firefox. */
type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface DragOrigin {
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
  overflowX: number;
  overflowY: number;
  /** Design px per CSS px, so a drag moves the photo under the cursor. */
  designPerCss: number;
}

export function CardPreview({
  state,
  canvasRef,
  patchArtwork,
  playing = true,
}: {
  state: CardState;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  patchArtwork?: (patch: Partial<ArtworkState>) => void;
  /** Video backgrounds only. A paused preview freezes the frame. */
  playing?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const assetsRef = useRef<RenderAssets | null>(null);
  const dragRef = useRef<DragOrigin | null>(null);
  const clipRef = useRef<HTMLVideoElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // The paint loop reads these instead of closing over them, so a keystroke
  // never tears the loop down and rebuilds it — it just marks the card dirty.
  const stateRef = useRef(state);
  const playingRef = useRef(playing);
  const cssWidthRef = useRef(0);
  const dirtyRef = useRef(true);
  const rafRef = useRef(0);
  const videoFrameRef = useRef(0);
  const qualityRef = useRef(1);
  const frameIntervalRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const qualityMovedAtRef = useRef(0);

  stateRef.current = state;
  playingRef.current = playing;

  /* -------------------------------------------------------------- */
  /* The paint loop                                                  */
  /* -------------------------------------------------------------- */

  /**
   * Paints at most one frame, and schedules another only while something is
   * actually moving. A still card settles into doing nothing at all: no timer,
   * no animation frame, no wake-ups on a laptop battery.
   */
  const pump = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const assets = assetsRef.current;
    const cssWidth = cssWidthRef.current;
    if (!canvas || !assets || cssWidth <= 0) return;

    const media = assets.artwork;
    const video =
      media && media.kind === 'video' ? (media.element as HTMLVideoElement) : null;

    if (video && media) {
      clipRef.current = video;
      const { clipStart, clipLength } = stateRef.current.artwork;
      const clip = resolveClip(media.duration, clipStart, clipLength);
      const end = clip.start + clip.length;
      if (video.currentTime < clip.start - 0.05 || video.currentTime > end) {
        video.currentTime = clip.start;
      }
      if (playingRef.current) {
        // Loop the chosen window rather than the whole file.
        if (video.ended || video.currentTime >= end) video.currentTime = clip.start;
        if (video.paused) void video.play().catch(() => undefined);
      } else if (!video.paused) {
        // A paused clip is left exactly where it is — seeking it back would
        // churn the decoder and change the frame under the export check.
        video.pause();
      }
    }

    if (dirtyRef.current) {
      dirtyRef.current = false;
      const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
      const natural = Math.min(MAX_PREVIEW_SCALE, Math.max(0.5, (cssWidth * dpr) / CARD.width));
      const floor = Math.min(natural, MIN_PREVIEW_SCALE);
      renderToCanvas(
        canvas,
        stateRef.current,
        assets,
        Math.max(floor, natural * qualityRef.current),
      );
    }

    if (!video || !playingRef.current) return;

    // How long frames are actually taking. The loop runs at the display's
    // cadence, so this only stretches when a paint is holding the main thread
    // up — which is exactly the case worth trading sharpness for.
    const now = performance.now();
    const gap = now - lastFrameAtRef.current;
    lastFrameAtRef.current = now;
    if (gap > 0 && gap < 500) {
      const average = frameIntervalRef.current ? frameIntervalRef.current * 0.85 + gap * 0.15 : gap;
      frameIntervalRef.current = average;
      if (now - qualityMovedAtRef.current > QUALITY_SETTLE_MS) {
        if (average > SLOW_FRAME_MS && qualityRef.current > 0.51) {
          qualityRef.current = Math.max(0.5, qualityRef.current - 0.2);
          qualityMovedAtRef.current = now;
          dirtyRef.current = true;
        } else if (average < FAST_FRAME_MS && qualityRef.current < 1) {
          qualityRef.current = Math.min(1, qualityRef.current + 0.2);
          qualityMovedAtRef.current = now;
          dirtyRef.current = true;
        }
      }
    }

    // `requestVideoFrameCallback` fires once per decoded frame, so a 24 fps
    // clip on a 120 Hz screen is painted 24 times a second instead of 120.
    // Firefox has no such callback and falls back to the display refresh.
    const withCallback = video as FrameCallbackVideo;
    if (withCallback.requestVideoFrameCallback) {
      if (!videoFrameRef.current) {
        videoFrameRef.current = withCallback.requestVideoFrameCallback(() => {
          videoFrameRef.current = 0;
          dirtyRef.current = true;
        });
      }
    } else {
      dirtyRef.current = true;
    }
    rafRef.current = requestAnimationFrame(pump);
  }, [canvasRef]);

  /** Marks the card dirty and makes sure exactly one frame is queued. */
  const request = useCallback(() => {
    dirtyRef.current = true;
    if (!rafRef.current) rafRef.current = requestAnimationFrame(pump);
  }, [pump]);

  /* -------------------------------------------------------------- */
  /* Inputs to the loop                                              */
  /* -------------------------------------------------------------- */

  // Width is deliberately not React state: a window resize would otherwise
  // re-render the whole editor on every observer callback.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const apply = (width: number) => {
      const rounded = Math.round(width);
      if (rounded === cssWidthRef.current) return;
      cssWidthRef.current = rounded;
      request();
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) apply(entry.contentRect.width);
    });
    observer.observe(wrap);
    apply(wrap.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [request]);

  // Assets only change when the chosen media changes, so decoding them stays
  // off the path a keystroke takes.
  useEffect(() => {
    let cancelled = false;
    void prepareAssets(stateRef.current).then((assets) => {
      if (cancelled) return;
      assetsRef.current = assets;
      request();
    });
    return () => {
      cancelled = true;
    };
  }, [state.artwork.imageId, state.avatarId, state.logoId, request]);

  // Anything else about the card changed: repaint, without touching assets.
  useEffect(request);

  // A webfont landing after the first paint changes the metrics under the
  // card, so what is on screen has to be measured and drawn again.
  useEffect(() => onFontsChanged(request), [request]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    },
    [],
  );

  // The library keeps decoded clips alive between selections, so one that is
  // no longer on the card has to be stopped explicitly or it plays on forever
  // behind a still background.
  useEffect(
    () => () => {
      const video = clipRef.current as FrameCallbackVideo | null;
      if (video && videoFrameRef.current) video.cancelVideoFrameCallback?.(videoFrameRef.current);
      videoFrameRef.current = 0;
      video?.pause();
      clipRef.current = null;
      frameIntervalRef.current = 0;
      lastFrameAtRef.current = 0;
      qualityRef.current = 1;
    },
    [state.artwork.imageId],
  );

  /* -------------------------------------------------------------- */
  /* Dragging the background                                         */
  /* -------------------------------------------------------------- */

  const canPan = Boolean(state.artwork.imageId && patchArtwork);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const media = assetsRef.current?.artwork;
      const canvas = canvasRef.current;
      if (!canPan || !media || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0) return;

      const placement = placeCover(
        media.width,
        media.height,
        CARD.width,
        CARD.height,
        state.artwork.zoom,
        state.artwork.offsetX,
        state.artwork.offsetY,
      );
      if (placement.overflowX <= 0 && placement.overflowY <= 0) return;

      dragRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        offsetX: state.artwork.offsetX,
        offsetY: state.artwork.offsetY,
        overflowX: placement.overflowX,
        overflowY: placement.overflowY,
        designPerCss: CARD.width / rect.width,
      };
      canvas.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    [canPan, canvasRef, state.artwork.offsetX, state.artwork.offsetY, state.artwork.zoom],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const origin = dragRef.current;
      if (!origin || !patchArtwork) return;
      event.preventDefault();
      const dx = (event.clientX - origin.pointerX) * origin.designPerCss;
      const dy = (event.clientY - origin.pointerY) * origin.designPerCss;
      patchArtwork({
        offsetX: panBy(origin.offsetX, dx, origin.overflowX),
        offsetY: panBy(origin.offsetY, dy, origin.overflowY),
      });
    },
    [patchArtwork],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
      canvasRef.current?.releasePointerCapture?.(event.pointerId);
    },
    [canvasRef],
  );

  return (
    <div className="preview" ref={wrapRef}>
      <div className="preview__frame" style={{ aspectRatio: `${CARD.width} / ${CARD.height}` }}>
        <canvas
          ref={canvasRef}
          className={`preview__canvas${canPan ? ' is-pannable' : ''}${dragging ? ' is-dragging' : ''}`}
          role="img"
          aria-label="PnL card preview"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
      {canPan ? <p className="preview__tip">Drag the card to reposition the background.</p> : null}
    </div>
  );
}
