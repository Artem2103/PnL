import { useEffect, useRef, useState } from 'react';
import { DrawTools } from './DrawTools';
import { INK_STEP, INK_TAU, strokeId, strokePath, type InkTool, type Stroke } from './drawing';
import { TIMEFRAMES, TIMEFRAME_LABEL, pickTimeframe, type PlacedPosition, type Timeframe } from './model';

/**
 * One trade, large. The canvas stays behind it, darkened and blurred. The
 * timeframe buttons swap the screenshot in place — same position, same modal —
 * with a crossfade; every timeframe of this trade and of its neighbours is
 * fetched ahead so the swap never waits on the network.
 *
 * With the brush on, you can draw on the screenshot. These are scratch marks:
 * kept per trade and timeframe while the viewer is open, gone when it closes.
 * Nothing is stored.
 */

interface Props {
  items: PlacedPosition[];
  index: number;
  onIndex(index: number): void;
  onClose(): void;
  /** Space is held: the viewer lets go of the pointer so the canvas can be dragged. */
  peek: boolean;
  drawing: boolean;
  onDrawing(drawing: boolean): void;
  tool: InkTool;
  onTool(tool: InkTool): void;
}

/** Scratch strokes, per `${position id}:${timeframe}`, in the screenshot's own pixels. */
type Scratch = Record<string, Stroke[]>;

const preloaded = new Set<string>();
function preload(url: string) {
  if (preloaded.has(url)) return;
  preloaded.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

export function PositionViewer({ items, index, onIndex, onClose, peek, drawing, onDrawing, tool, onTool }: Props) {
  const item = items[index];
  const [wanted, setWanted] = useState<Timeframe>('15m');
  const [fullscreen, setFullscreen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const position = item?.position;
  const tf = position ? pickTimeframe(position, wanted) : null;
  const frame = position && tf ? position.frames[tf] : undefined;
  const [scratch, setScratch] = useState<Scratch>({});
  const key = position && tf ? `${position.id}:${tf}` : '';
  const keyRef = useRef(key);
  keyRef.current = key;
  const inkRef = useRef<SVGSVGElement>(null);
  const livePathRef = useRef<SVGPathElement>(null);
  const pen = useRef<{ pointerId: number; key: string; points: number[]; sx: number; sy: number; t: number; lastX: number; lastY: number } | null>(null);
  const hasDrawings = Object.values(scratch).some((list) => list.length > 0);

  // Opening always starts on 15M (the viewer mounts fresh each time); moving to
  // a neighbour keeps the chosen timeframe where that trade has it.

  // The originals are full-size screenshots and every download is Supabase
  // egress, so only what is likely to be looked at next is fetched: the
  // neighbours' picture at the timeframe they would open on. Another timeframe
  // of the open trade loads when it is picked.
  useEffect(() => {
    for (const i of [index + 1, index - 1]) {
      const p = items[i]?.position;
      const t = p ? pickTimeframe(p, wanted) : null;
      const f = p && t ? p.frames[t] : undefined;
      if (f) preload(f.full);
    }
  }, [index, items, wanted]);

  // Per trade: the timeframes mounted so far and those finished loading. Until
  // the picked one has loaded, the one before it stays up — no white flash.
  const [loaded, setLoaded] = useState<{ id: string; mounted: Timeframe[]; ready: Timeframe[]; last: Timeframe | null }>({
    id: '',
    mounted: [],
    ready: [],
    last: null,
  });
  const view = loaded.id === position?.id ? loaded : { id: position?.id ?? '', mounted: [], ready: [], last: null };
  const mounted = tf && !view.mounted.includes(tf) ? [...view.mounted, tf] : view.mounted;
  const showing = tf && view.ready.includes(tf) ? tf : view.last;
  const markReady = (t: Timeframe) =>
    setLoaded((prev) => {
      const base = prev.id === position?.id ? prev : { id: position?.id ?? '', mounted: [], ready: [], last: null };
      return {
        id: base.id,
        mounted: mounted,
        ready: base.ready.includes(t) ? base.ready : [...base.ready, t],
        last: t === tf ? t : base.last ?? t,
      };
    });

  const prev = index > 0 ? index - 1 : null;
  const next = index < items.length - 1 ? index + 1 : null;

  // Ctrl/⌘+Z takes back the last stroke on the screenshot shown.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      const k = keyRef.current;
      setScratch((all) => (all[k]?.length ? { ...all, [k]: all[k].slice(0, -1) } : all));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!document.fullscreenElement) onClose();
      } else if (event.key === 'ArrowLeft' && prev != null) {
        event.preventDefault();
        onIndex(prev);
      } else if (event.key === 'ArrowRight' && next != null) {
        event.preventDefault();
        onIndex(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, onClose, onIndex, prev]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === modalRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void modalRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  /** Screen point → screenshot pixels (the ink layer's viewBox). */
  const toImage = (clientX: number, clientY: number) => {
    const m = inkRef.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y] as const;
  };

  const endPen = () => {
    pen.current = null;
    livePathRef.current?.setAttribute('d', '');
  };

  const onInkDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing || pen.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const at = toImage(event.clientX, event.clientY);
    if (!at) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pen.current = {
      pointerId: event.pointerId,
      key,
      points: [at[0], at[1]],
      sx: event.clientX,
      sy: event.clientY,
      t: event.timeStamp,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    livePathRef.current?.setAttribute('d', strokePath(pen.current.points));
  };

  const onInkMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const p = pen.current;
    if (!p || p.pointerId !== event.pointerId) return;
    // Same stabiliser as the board: the pen eases toward the pointer.
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const e of samples.length ? samples : [event.nativeEvent]) {
      const k = 1 - Math.exp(-Math.max(1, e.timeStamp - p.t) / INK_TAU);
      p.t = Math.max(p.t, e.timeStamp);
      p.sx += (e.clientX - p.sx) * k;
      p.sy += (e.clientY - p.sy) * k;
      if (Math.hypot(p.sx - p.lastX, p.sy - p.lastY) < INK_STEP) continue;
      const at = toImage(p.sx, p.sy);
      if (!at) continue;
      p.points.push(at[0], at[1]);
      p.lastX = p.sx;
      p.lastY = p.sy;
    }
    livePathRef.current?.setAttribute('d', strokePath(p.points));
  };

  const onInkUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const p = pen.current;
    if (!p || p.pointerId !== event.pointerId) return;
    endPen();
    if (event.type === 'pointercancel') return;
    const stroke: Stroke = { id: strokeId(), color: tool.color, width: tool.width, points: p.points };
    setScratch((all) => ({ ...all, [p.key]: [...(all[p.key] ?? []), stroke] }));
  };

  if (!item || !position || !frame || !tf) return null;
  const name = item.category.name;

  const tools = (
    <DrawTools
      className="bv-draw"
      active={drawing}
      onActive={onDrawing}
      tool={tool}
      onTool={onTool}
      hasDrawings={hasDrawings}
      onClearDrawings={() => {
        endPen();
        setScratch({});
      }}
    />
  );

  return (
    <div
      className={`bv${peek ? ' is-peek' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* In full screen only the modal is shown, so the toolbar moves into it. */}
      {fullscreen ? null : tools}
      <div ref={modalRef} className={`bv-modal${fullscreen ? ' is-fullscreen' : ''}`}>
        {fullscreen ? tools : null}
        <header className="bv-bar">
          <h2 className="bv-title">{item.category.name}</h2>
          <div className="bv-tfs" role="tablist" aria-label="Timeframe">
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={t === tf}
                className={`bv-tf${t === tf ? ' is-active' : ''}`}
                disabled={!position.frames[t]}
                onClick={() => setWanted(t)}
              >
                {TIMEFRAME_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="bv-tools">
            {position.link ? (
              <a className="bv-icon" href={position.link} target="_blank" rel="noopener noreferrer" aria-label="Open on Telegram" title="Open on Telegram">
                <TelegramIcon />
              </a>
            ) : null}
            <button type="button" className="bv-icon" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                {fullscreen ? <path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" /> : <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" />}
              </svg>
            </button>
            <button type="button" className="bv-icon" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>
        </header>

        <div className="bv-stage" key={position.id} style={{ aspectRatio: `${frame.w} / ${frame.h}` }}>
          {TIMEFRAMES.map((t) => {
            const f = position.frames[t];
            if (!f || !mounted.includes(t)) return null;
            return (
              <img
                key={t}
                src={f.full}
                alt={`${name} · ${TIMEFRAME_LABEL[t]}`}
                className={t === showing ? 'is-shown' : undefined}
                draggable={false}
                decoding="async"
                onLoad={() => markReady(t)}
              />
            );
          })}
          <svg
            ref={inkRef}
            className={`bv-ink${drawing ? ' is-drawing' : ''}`}
            viewBox={`0 0 ${frame.w} ${frame.h}`}
            onPointerDown={onInkDown}
            onPointerMove={onInkMove}
            onPointerUp={onInkUp}
            onPointerCancel={onInkUp}
            aria-hidden="true"
          >
            {(scratch[key] ?? []).map((s) => (
              <path key={s.id} d={strokePath(s.points)} stroke={s.color} strokeWidth={s.width} />
            ))}
            <path ref={livePathRef} stroke={tool.color} strokeWidth={tool.width} />
          </svg>
        </div>

        <button
          type="button"
          className="bv-arrow bv-arrow--prev"
          onClick={() => prev != null && onIndex(prev)}
          disabled={prev == null}
          aria-label="Previous position"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M12.5 4l-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          className="bv-arrow bv-arrow--next"
          onClick={() => next != null && onIndex(next)}
          disabled={next == null}
          aria-label="Next position"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7.5 4l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** Telegram's paper plane. */
function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="bv-tg">
      <path d="M21.6 3.4 2.9 10.6c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.4l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.3-1.5ZM8.8 13.3l9.9-6.3c.5-.3.9-.1.5.2l-8.4 7.6-.3 3.6-1.7-5.1Z" />
    </svg>
  );
}
