import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardState } from '../types';
import { CARD, prepareAssets, renderToCanvas } from '../lib/render';

/** Preview beyond 2× device pixels is invisible and costs real time. */
const MAX_PREVIEW_SCALE = 2;

export function CardPreview({
  state,
  canvasRef,
}: {
  state: CardState;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cssWidth, setCssWidth] = useState(0);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cssWidth <= 0) return;

    let cancelled = false;
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const scale = Math.min(MAX_PREVIEW_SCALE, Math.max(0.5, (cssWidth * dpr) / CARD.width));

    // Assets (fonts, artwork, avatar) resolve first so no partial frame shows.
    prepareAssets(state).then((assets) => {
      if (cancelled) return;
      renderToCanvas(canvas, state, assets, scale);
    });

    return () => {
      cancelled = true;
    };
  }, [state, cssWidth, canvasRef]);

  return (
    <div className="preview" ref={wrapRef}>
      <div className="preview__frame" style={{ aspectRatio: `${CARD.width} / ${CARD.height}` }}>
        <canvas ref={canvasRef} className="preview__canvas" role="img" aria-label="PnL card preview" />
      </div>
    </div>
  );
}
