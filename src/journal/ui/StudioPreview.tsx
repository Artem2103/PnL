import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CardState, RenderAssets, StudioClip } from '../../types';
import { loadMedia, peekMedia } from '../../lib/images';
import { prepareAssets } from '../../lib/render';
import { onFontsChanged } from '../../lib/fonts';
import { panBy, placeCover } from '../../lib/canvas/placement';
import {
  aspectRatio,
  cardRect,
  clipAt,
  ForegroundCache,
  paintStudioFrame,
  timeline,
  type Rect,
} from '../../lib/studio/frame';
import { getSound } from '../../lib/studio/sounds';

export interface StudioPlayer {
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
}

interface Drag {
  x: number;
  y: number;
  /** The clip's pan when the drag started. */
  a: number;
  b: number;
  overflowX: number;
  overflowY: number;
}

/**
 * The studio's live picture: the timeline played clip after clip, the card
 * over it, and the added sounds in step. The same `paintStudioFrame` the
 * exporter uses, so what plays here is what lands in the file.
 *
 * The card stays put. Dragging moves the clip behind it and the wheel zooms it.
 */
export const StudioPreview = forwardRef<
  StudioPlayer,
  {
    state: CardState;
    onClip: (id: string, patch: Partial<StudioClip>) => void;
    playing: boolean;
    onPlaying: (playing: boolean) => void;
    onTime: (t: number) => void;
  }
>(function StudioPreview({ state, onClip, playing, onPlaying, onTime }, ref) {
  const studio = state.studio;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [card, setCard] = useState<Rect | null>(null);
  const assetsRef = useRef<RenderAssets | null>(null);
  const cacheRef = useRef(new ForegroundCache());
  const stateRef = useRef(state);
  stateRef.current = state;
  const timeRef = useRef(0);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const lastReport = useRef(0);
  const soundsRef = useRef(new Map<string, HTMLAudioElement>());
  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef(0);
  const [, setReady] = useState(0);

  // The frame's own shape, as large as the space allows.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      const box = wrap.getBoundingClientRect();
      const ratio = aspectRatio(studio.aspect);
      let width = box.width;
      let height = width / ratio;
      if (height > box.height) {
        height = box.height;
        width = height * ratio;
      }
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    fit();
    return () => observer.disconnect();
  }, [studio.aspect]);

  // Avatar, logo mark and instrument logo; the clip comes from the library.
  useEffect(() => {
    let cancelled = false;
    void prepareAssets({ ...state, artwork: { ...state.artwork, imageId: null } }).then((assets) => {
      if (!cancelled) assetsRef.current = { ...assets, artwork: null };
    });
    return () => {
      cancelled = true;
    };
  }, [state.avatarId, state.mode, state.display.showTokenImage, state.trade.logoUrl]);

  // Decode every clip on the timeline once; the library keeps them.
  const clipIds = studio.clips.map((c) => c.mediaId).join('|');
  useEffect(() => {
    let cancelled = false;
    void Promise.all(studio.clips.map((c) => loadMedia(c.mediaId))).then(() => {
      if (!cancelled) setReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [clipIds]);

  // The added sounds, as <audio> elements kept in step with the clock.
  const trackIds = studio.tracks.map((t) => t.soundId).join('|');
  useEffect(() => {
    const sounds = soundsRef.current;
    let cancelled = false;
    void (async () => {
      for (const track of studio.tracks) {
        if (sounds.has(track.soundId)) continue;
        const record = await getSound(track.soundId);
        if (cancelled || !record) continue;
        const audio = new Audio(URL.createObjectURL(record.blob));
        audio.preload = 'auto';
        sounds.set(track.soundId, audio);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trackIds]);

  useEffect(
    () => () => {
      for (const audio of soundsRef.current.values()) {
        audio.pause();
        URL.revokeObjectURL(audio.src);
      }
      soundsRef.current.clear();
      // Library clips are shared with the editor: leave them paused and silent.
      for (const clip of stateRef.current.studio.clips) {
        const element = peekMedia(clip.mediaId)?.element;
        if (element instanceof HTMLVideoElement) {
          element.pause();
          element.muted = true;
        }
      }
    },
    [],
  );

  const videoOf = (clip: StudioClip | null | undefined): HTMLVideoElement | null => {
    if (!clip) return null;
    const element = peekMedia(clip.mediaId)?.element;
    return element instanceof HTMLVideoElement ? element : null;
  };

  /** Puts every element where the clock says and paints one frame. */
  const step = useCallback(() => {
    const s = stateRef.current;
    const clips = s.studio.clips;
    const { total } = timeline(clips);
    let t = timeRef.current;
    const at = clipAt(clips, t);
    const video = videoOf(at?.clip);

    if (playingRef.current && at && video) {
      // The playing clip is the clock: the picture can never run ahead of it.
      if (Math.abs(video.currentTime - at.fileTime) > 0.3) video.currentTime = at.fileTime;
      video.muted = false;
      video.volume = at.clip.volume;
      if (video.paused) void video.play().catch(() => undefined);
      const { starts } = timeline(clips);
      t = starts[at.index]! + (video.currentTime - at.clip.start);
      if (video.currentTime >= at.clip.start + at.clip.length - 0.02) {
        // End of this clip: on to the next, or round again.
        video.pause();
        t = at.index + 1 < clips.length ? starts[at.index + 1]! : 0;
        const next = clipAt(clips, t);
        const nextVideo = videoOf(next?.clip);
        if (next && nextVideo) nextVideo.currentTime = next.fileTime;
      }
      timeRef.current = t;
    } else if (at && video) {
      if (!video.paused) video.pause();
      if (Math.abs(video.currentTime - at.fileTime) > 0.04 && !video.seeking) video.currentTime = at.fileTime;
    }
    // Clips not on screen stay quiet.
    for (const clip of clips) {
      const other = videoOf(clip);
      if (other && other !== video && !other.paused) other.pause();
    }

    for (const track of s.studio.tracks) {
      const audio = soundsRef.current.get(track.soundId);
      if (!audio) continue;
      const within = t >= track.at && t < track.at + track.length;
      if (playingRef.current && within) {
        const want = track.start + (t - track.at);
        if (Math.abs(audio.currentTime - want) > 0.3) audio.currentTime = want;
        audio.volume = track.volume;
        if (audio.paused) void audio.play().catch(() => undefined);
      } else if (!audio.paused) {
        audio.pause();
      }
    }

    const canvas = canvasRef.current;
    const assets = assetsRef.current;
    if (canvas && assets && canvas.width > 0) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const ready = video && video.readyState >= 2;
        paintStudioFrame(
          ctx,
          canvas.width,
          canvas.height,
          s,
          at?.clip ?? null,
          ready ? { element: video, width: video.videoWidth, height: video.videoHeight } : null,
          assets,
          cacheRef.current,
        );
      }
    }

    const now = performance.now();
    if (now - lastReport.current > 100) {
      lastReport.current = now;
      onTime(Math.min(t, total));
    }
  }, [onTime]);

  // One loop for the life of the preview; it reads everything through refs.
  useEffect(() => {
    const loop = () => {
      step();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [step]);

  useEffect(() => onFontsChanged(() => (cacheRef.current = new ForegroundCache())), []);

  // Pausing stops every element at once, not on the next frame.
  useEffect(() => {
    if (playing) return;
    for (const clip of studio.clips) videoOf(clip)?.pause();
    for (const audio of soundsRef.current.values()) audio.pause();
  }, [playing]);

  useImperativeHandle(
    ref,
    () => ({
      play: () => onPlaying(true),
      pause: () => onPlaying(false),
      seek: (t: number) => {
        timeRef.current = Math.max(0, t);
        const at = clipAt(stateRef.current.studio.clips, t);
        const video = videoOf(at?.clip);
        if (at && video) video.currentTime = at.fileTime;
        for (const audio of soundsRef.current.values()) audio.pause();
        onTime(t);
      },
    }),
    [onPlaying, onTime],
  );

  // Canvas pixels follow the frame size and the screen's density.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    setCard(studio.aspect === 'card' ? null : cardRect(studio, size.width, size.height));
  }, [size, studio]);

  const active = () => clipAt(studio.clips, timeRef.current);

  // Only the clip moves; the card stays where it is.
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const at = active();
    const video = videoOf(at?.clip);
    if (!at || !video || !video.videoWidth) return;
    const placed = placeCover(video.videoWidth, video.videoHeight, size.width, size.height, at.clip.zoom, at.clip.offsetX, at.clip.offsetY);
    if (placed.overflowX <= 0 && placed.overflowY <= 0) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      a: at.clip.offsetX,
      b: at.clip.offsetY,
      overflowX: placed.overflowX,
      overflowY: placed.overflowY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const at = active();
    if (!drag || !at) return;
    // The picture follows the pointer, the way the card editor's does.
    onClip(at.clip.id, {
      offsetX: panBy(drag.a, event.clientX - drag.x, drag.overflowX),
      offsetY: panBy(drag.b, event.clientY - drag.y, drag.overflowY),
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  // The wheel zooms the clip.
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const at = active();
    if (!at) return;
    const factor = event.deltaY < 0 ? 1.06 : 1 / 1.06;
    onClip(at.clip.id, { zoom: Math.min(3, Math.max(1, at.clip.zoom * factor)) });
  };

  return (
    <div className="jx-stage" ref={wrapRef}>
      <div
        className={`jx-stage__frame${dragging ? ' is-dragging' : ''}`}
        style={{ width: size.width, height: size.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} aria-label="Video preview" role="img" />
        {card ? (
          <span
            className="jx-stage__card"
            style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
            aria-hidden="true"
          />
        ) : null}
        {!studio.clips.length ? <span className="jx-stage__empty">No Video</span> : null}
      </div>
    </div>
  );
});
