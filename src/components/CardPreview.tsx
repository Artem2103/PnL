import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArtworkState, CardState, RenderAssets } from '../types';
import { CARD, prepareAssets, renderToCanvas } from '../lib/render';
import { placeCover, panBy } from '../lib/canvas/placement';
import { resolveClip } from '../lib/video';

/** Preview beyond 2× device pixels is invisible and costs real time. */
const MAX_PREVIEW_SCALE = 2;

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
  const [cssWidth, setCssWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setCssWidth(entry.contentRect.width);
    });
    observer.observe(wrap);
    setCssWidth(wrap.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  // The library keeps decoded clips alive between selections, so one that is
  // no longer on the card has to be stopped explicitly or it plays on forever
  // behind a still background.
  useEffect(
    () => () => {
      clipRef.current?.pause();
      clipRef.current = null;
    },
    [state.artwork.imageId],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cssWidth <= 0) return;

    let cancelled = false;
    let frame = 0;
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const scale = Math.min(MAX_PREVIEW_SCALE, Math.max(0.5, (cssWidth * dpr) / CARD.width));

    // Assets (fonts, artwork, avatar) resolve first so no partial frame shows.
    prepareAssets(state).then((assets) => {
      if (cancelled) return;
      assetsRef.current = assets;

      const media = assets.artwork;
      const video =
        media && media.kind === 'video' ? (media.element as HTMLVideoElement) : null;

      if (!media || !video) {
        renderToCanvas(canvas, state, assets, scale);
        return;
      }

      clipRef.current = video;
      const clip = resolveClip(media.duration, state.artwork.clipStart, state.artwork.clipLength);
      const end = clip.start + clip.length;
      if (video.currentTime < clip.start - 0.05 || video.currentTime > end) {
        video.currentTime = clip.start;
      }

      // The clip is redrawn every frame rather than on a timer, so the preview
      // shows exactly the frame the recorder would capture at that instant.
      const tick = () => {
        if (cancelled) return;
        if (playing) {
          // Loop the chosen window rather than the whole file.
          if (video.ended || video.currentTime >= end) video.currentTime = clip.start;
          if (video.paused) void video.play().catch(() => undefined);
        } else if (!video.paused) {
          // A paused clip is left exactly where it is — seeking it back would
          // churn the decoder and change the frame under the export check.
          video.pause();
        }
        renderToCanvas(canvas, state, assetsRef.current ?? assets, scale);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [state, cssWidth, canvasRef, playing]);

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
