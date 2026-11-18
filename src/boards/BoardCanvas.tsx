import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { DrawTools } from './DrawTools';
import { loadStrokes, loadTool, saveStrokes, saveTool, strokeId, strokePath, type InkTool, type Stroke } from './drawing';
import {
  COLUMN_WIDTH,
  HEADER_HEIGHT,
  PADDING,
  clampView,
  clampZoom,
  coverFrame,
  initialView,
  zoomAt,
  type Layout,
  type PlacedPosition,
  type View,
} from './model';

/**
 * The board: one layer moved and scaled as a whole. Positions are fixed in it;
 * nothing on the canvas can be picked up, so every drag — on empty space or on a
 * screenshot — moves the view, and a double-click (or double-tap) on a
 * screenshot opens it.
 *
 * The view lives in a ref and is written straight to the DOM. Panning re-renders
 * nothing in React; only the transform changes.
 *
 * With the brush on, a one-finger / left-button drag draws instead of panning.
 * Panning still works with Space+drag and the middle button; the wheel and pinch zoom.
 */

interface Props {
  layout: Layout;
  /** Space is held: the cursor says "grab" everywhere. */
  spaceHeld: boolean;
  /** A canvas copy is too soft at this zoom; show the originals. */
  onSharpChange?: (sharp: boolean) => void;
  sharp: boolean;
  onOpen(index: number): void;
}

/** How far a press may wander and still count as a click, in screen pixels. */
const TAP_SLOP = 5;
const DOUBLE_TAP_MS = 380;
/** Wheel and button moves ease in over roughly this time constant. */
const GLIDE_TAU = 70;
/** A flick coasts for about this long. */
const COAST_TAU = 260;
/** Points closer than this on screen are skipped while drawing. */
const INK_STEP = 2.5;
/**
 * Stabiliser time constant (ms): the pen eases toward the pointer, which irons
 * out hand tremor. Time-based, so it feels the same at any mouse polling rate.
 * Higher = smoother but laggier.
 */
const INK_TAU = 20;

export function BoardCanvas({ layout, spaceHeld, sharp, onSharpChange, onOpen }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const view = useRef<View>({ x: 0, y: 0, z: 1 });
  const size = useRef({ w: 0, h: 0 });
  const placed = useRef(false);
  const glide = useRef<{ target: View; tau: number } | null>(null);
  const frame = useRef<number | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const sharpRef = useRef(sharp);
  sharpRef.current = sharp;
  const onSharpRef = useRef(onSharpChange);
  onSharpRef.current = onSharpChange;

  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<InkTool>(loadTool);
  const [strokes, setStrokes] = useState<Stroke[]>(loadStrokes);
  const livePathRef = useRef<SVGPathElement>(null);
  /** sx/sy: the smoothed pen, lastX/lastY: the last point kept (screen px). */
  const ink = useRef<{ pointerId: number; points: number[]; sx: number; sy: number; t: number; lastX: number; lastY: number } | null>(null);

  useEffect(() => saveStrokes(strokes), [strokes]);
  useEffect(() => saveTool(tool), [tool]);

  // Ctrl/⌘+Z takes back the last stroke.
  useEffect(() => {
    if (strokes.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      const t = event.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      event.preventDefault();
      setStrokes((all) => all.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [strokes.length]);

  const clamp = useCallback(
    (v: View) => clampView(v, size.current.w, size.current.h, layoutRef.current.width, layoutRef.current.height),
    [],
  );

  const paint = useCallback(() => {
    const v = view.current;
    const world = worldRef.current;
    const viewport = viewportRef.current;
    if (!world || !viewport) return;
    world.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.z})`;
    // Stroke widths divide by this, so ink stays 1–4 screen px at every zoom.
    world.style.setProperty('--bd-z', String(v.z));

    // Column letters follow the columns sideways and stick to the top.
    const labels = labelsRef.current;
    if (labels) {
      const top = Math.max(14, v.y + (PADDING + HEADER_HEIGHT / 2 - 14) * v.z);
      layoutRef.current.columns.forEach((column, i) => {
        const el = labels.children[i] as HTMLElement | undefined;
        if (el) el.style.transform = `translate3d(${v.x + (column.x + COLUMN_WIDTH / 2) * v.z}px, ${top}px, 0) translateX(-50%)`;
      });
    }
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(v.z * 100)}%`;

    const wantSharp = v.z * (window.devicePixelRatio || 1) * COLUMN_WIDTH > 1100;
    if (wantSharp !== sharpRef.current) onSharpRef.current?.(wantSharp);
  }, []);

  const stopMotion = useCallback(() => {
    glide.current = null;
  }, []);

  const step = useCallback(
    (now: number, last: number) => {
      const g = glide.current;
      if (!g) {
        frame.current = null;
        return;
      }
      const dt = Math.min(48, now - last);
      const k = 1 - Math.exp(-dt / g.tau);
      const v = view.current;
      const t = g.target;
      const next = { x: v.x + (t.x - v.x) * k, y: v.y + (t.y - v.y) * k, z: v.z + (t.z - v.z) * k };
      const done = Math.abs(t.x - next.x) < 0.25 && Math.abs(t.y - next.y) < 0.25 && Math.abs(t.z - next.z) < 0.0005;
      view.current = done ? t : next;
      paint();
      if (done) {
        glide.current = null;
        frame.current = null;
        return;
      }
      frame.current = requestAnimationFrame((time) => step(time, now));
    },
    [paint],
  );

  /** Eases the view to `target`. Repeated calls retarget the same motion. */
  const glideTo = useCallback(
    (target: View, tau = GLIDE_TAU) => {
      glide.current = { target: clamp(target), tau };
      if (frame.current == null) {
        const start = performance.now();
        frame.current = requestAnimationFrame((time) => step(time, start));
      }
    },
    [clamp, step],
  );

  const setNow = useCallback(
    (next: View) => {
      stopMotion();
      view.current = clamp(next);
      paint();
    },
    [clamp, paint, stopMotion],
  );

  /** Where the view is heading: the glide's goal if one is running. */
  const goal = () => glide.current?.target ?? view.current;

  const zoomBy = (factor: number) => {
    const g = goal();
    glideTo(zoomAt(g, g.z * factor, size.current.w / 2, size.current.h / 2), 90);
  };
  const reset = () => glideTo(initialView(size.current.w), 110);

  // The first placement waits for both a size and a board: clamping against
  // the empty board shown while loading would centre it and leave it there.
  const placeOnce = useCallback(() => {
    if (placed.current || size.current.w === 0 || layoutRef.current.items.length === 0) return;
    placed.current = true;
    view.current = initialView(size.current.w);
  }, []);

  // Size, and the first placement once the size is known.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      size.current = { w: viewport.clientWidth, h: viewport.clientHeight };
      placeOnce();
      setNow(view.current);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [placeOnce, setNow]);

  // A new layout (data arrived, an admin edit) keeps the view but re-clamps it.
  useEffect(() => {
    placeOnce();
    setNow(view.current);
  }, [layout, placeOnce, setNow]);

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
  }, []);

  // Wheel: zooms at the cursor. Shift+wheel (or a sideways scroll) pans sideways.
  // Not a React handler: those are passive, and the page must not scroll or zoom.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? size.current.h : 1;
      const g = goal();
      if (event.shiftKey) {
        // Some browsers turn Shift+wheel into deltaX themselves; take whichever came.
        const d = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
        glideTo({ ...g, x: g.x - d });
        return;
      }
      // A sideways-only scroll (trackpad swipe, tilt wheel) still pans sideways.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && !(event.ctrlKey || event.metaKey)) {
        glideTo({ ...g, x: g.x - event.deltaX * unit });
        return;
      }
      // The wheel zooms at the cursor (Ctrl/⌘ and trackpad pinch too).
      const rect = viewport.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * unit * 0.0022);
      glideTo(zoomAt(g, clampZoom(g.z * factor), event.clientX - rect.left, event.clientY - rect.top), 60);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [glideTo]);

  // Dragging, flicking, pinching and double-tapping, all from pointer events.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number;
    startY: number;
    moved: boolean;
    vx: number;
    vy: number;
    t: number;
    pinch: { d: number; cx: number; cy: number } | null;
  } | null>(null);
  const lastTap = useRef<{ index: number; x: number; y: number; t: number } | null>(null);

  const indexAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-index]');
    return el && viewportRef.current?.contains(el) ? Number(el.dataset.index) : null;
  };

  const pinchOf = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };

  /** Screen point → board point. */
  const toWorld = (clientX: number, clientY: number) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    const v = view.current;
    return [(clientX - rect.left - v.x) / v.z, (clientY - rect.top - v.y) / v.z] as const;
  };

  const cancelInk = () => {
    ink.current = null;
    livePathRef.current?.setAttribute('d', '');
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stopMotion();
    if (pointers.current.size === 1) {
      if (drawing && !spaceHeld && event.button === 0) {
        const [x, y] = toWorld(event.clientX, event.clientY);
        ink.current = {
          pointerId: event.pointerId,
          points: [x, y],
          sx: event.clientX,
          sy: event.clientY,
          t: event.timeStamp,
          lastX: event.clientX,
          lastY: event.clientY,
        };
        livePathRef.current?.setAttribute('d', strokePath([x, y]));
        gesture.current = null;
        return;
      }
      gesture.current = { startX: event.clientX, startY: event.clientY, moved: false, vx: 0, vy: 0, t: event.timeStamp, pinch: null };
    } else {
      // A second finger turns a stroke that just began into a pinch.
      if (ink.current) cancelInk();
      gesture.current ??= { startX: event.clientX, startY: event.clientY, moved: true, vx: 0, vy: 0, t: event.timeStamp, pinch: null };
      gesture.current.moved = true;
      gesture.current.pinch = pinchOf();
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(event.pointerId);
    if (!prev) return;
    const stroke = ink.current;
    if (stroke && stroke.pointerId === event.pointerId) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // Coalesced events keep fast strokes smooth where the browser offers them.
      const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const e of samples.length ? samples : [event.nativeEvent]) {
        const k = 1 - Math.exp(-Math.max(1, e.timeStamp - stroke.t) / INK_TAU);
        stroke.t = Math.max(stroke.t, e.timeStamp);
        stroke.sx += (e.clientX - stroke.sx) * k;
        stroke.sy += (e.clientY - stroke.sy) * k;
        if (Math.hypot(stroke.sx - stroke.lastX, stroke.sy - stroke.lastY) < INK_STEP) continue;
        const [x, y] = toWorld(stroke.sx, stroke.sy);
        stroke.points.push(x, y);
        stroke.lastX = stroke.sx;
        stroke.lastY = stroke.sy;
      }
      livePathRef.current?.setAttribute('d', strokePath(stroke.points));
      return;
    }
    const g = gesture.current;
    if (!g) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2) {
      const now = pinchOf();
      if (!now || !g.pinch) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const zoomed = zoomAt(view.current, view.current.z * (now.d / g.pinch.d), now.cx - rect.left, now.cy - rect.top);
      setNow({ ...zoomed, x: zoomed.x + now.cx - g.pinch.cx, y: zoomed.y + now.cy - g.pinch.cy });
      g.pinch = now;
      return;
    }

    const dx = event.clientX - prev.x;
    const dy = event.clientY - prev.y;
    if (!g.moved && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > TAP_SLOP) {
      g.moved = true;
      viewportRef.current?.classList.add('is-dragging');
    }
    if (!g.moved) return;
    setNow({ ...view.current, x: view.current.x + dx, y: view.current.y + dy });
    // Velocity in px/ms, smoothed so one jittery event doesn't decide the flick.
    const dt = Math.max(1, event.timeStamp - g.t);
    g.vx = g.vx * 0.6 + (dx / dt) * 0.4;
    g.vy = g.vy * 0.6 + (dy / dt) * 0.4;
    g.t = event.timeStamp;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    const stroke = ink.current;
    if (stroke && stroke.pointerId === event.pointerId) {
      cancelInk();
      if (event.type !== 'pointercancel') {
        setStrokes((all) => [...all, { id: strokeId(), color: tool.color, width: tool.width, points: stroke.points }]);
      }
      return;
    }
    const g = gesture.current;
    if (pointers.current.size > 0) {
      if (g) g.pinch = pinchOf();
      return;
    }
    gesture.current = null;
    viewportRef.current?.classList.remove('is-dragging');
    if (!g || event.type === 'pointercancel') return;

    if (g.moved) {
      // A flick coasts; a drag that stopped before letting go doesn't.
      const idle = event.timeStamp - g.t;
      if (idle < 60 && Math.hypot(g.vx, g.vy) > 0.15) {
        glideTo({ ...view.current, x: view.current.x + g.vx * COAST_TAU, y: view.current.y + g.vy * COAST_TAU }, COAST_TAU);
      }
      return;
    }

    const index = indexAt(event.clientX, event.clientY);
    const last = lastTap.current;
    if (
      index != null &&
      last &&
      last.index === index &&
      event.timeStamp - last.t < DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - last.x, event.clientY - last.y) < 12
    ) {
      lastTap.current = null;
      onOpen(index);
      return;
    }
    lastTap.current = index == null ? null : { index, x: event.clientX, y: event.clientY, t: event.timeStamp };
  };

  return (
    <div className="bd-stage">
      <div
        ref={viewportRef}
        className={`bd-canvas${spaceHeld ? ' is-grab' : drawing ? ' is-drawing' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div ref={worldRef} className="bd-world" style={{ width: layout.width, height: layout.height }}>
          <Positions items={layout.items} sharp={sharp} />
          <svg className="bd-ink" width={layout.width} height={layout.height} aria-hidden="true">
            <Strokes strokes={strokes} />
            <path ref={livePathRef} stroke={tool.color} style={{ strokeWidth: `calc(${tool.width}px / var(--bd-z, 1))` }} />
          </svg>
        </div>
        <div ref={labelsRef} className="bd-labels" aria-hidden="true">
          {layout.columns.map((column) => (
            <span key={column.category.id} className="bd-label">
              {column.category.name}
            </span>
          ))}
        </div>
      </div>
      <DrawTools
        active={drawing}
        onActive={setDrawing}
        tool={tool}
        onTool={setTool}
        hasDrawings={strokes.length > 0}
        onClear={() => {
          cancelInk();
          setStrokes([]);
        }}
      />
      <div className="bd-zoom" role="group" aria-label="Zoom">
        <button type="button" className="bd-zoom__btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9" /></svg>
        </button>
        <button type="button" className="bd-zoom__level" onClick={reset} title="Reset view" aria-label="Reset view">
          <span ref={zoomLabelRef}>100%</span>
        </button>
        <button type="button" className="bd-zoom__btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9" /></svg>
        </button>
      </div>
    </div>
  );
}

/** Finished strokes; re-rendered only when one is added or removed. */
const Strokes = memo(function Strokes({ strokes }: { strokes: Stroke[] }) {
  return (
    <>
      {strokes.map((s) => (
        <path key={s.id} d={strokePath(s.points)} stroke={s.color} style={{ strokeWidth: `calc(${s.width}px / var(--bd-z, 1))` }} />
      ))}
    </>
  );
});

/** Re-rendered only when the board or the sharpness changes, never by panning. */
const Positions = memo(function Positions({ items, sharp }: { items: PlacedPosition[]; sharp: boolean }) {
  return (
    <>
      {items.map((item, index) => {
        const frame = coverFrame(item.position);
        if (!frame) return null;
        return (
          <div
            key={item.position.id}
            className="bd-pos"
            data-index={index}
            style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
          >
            <img
              src={sharp ? frame.full : frame.thumb}
              alt={`${item.category.name} ${item.number}`}
              width={frame.w}
              height={frame.h}
              draggable={false}
              loading="lazy"
              decoding="async"
            />
          </div>
        );
      })}
    </>
  );
});
