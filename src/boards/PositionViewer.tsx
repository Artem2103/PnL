import { useEffect, useRef, useState } from 'react';
import { TIMEFRAMES, TIMEFRAME_LABEL, pickTimeframe, type PlacedPosition, type Timeframe } from './model';

/**
 * One trade, large. The canvas stays behind it, darkened and blurred. The
 * timeframe buttons swap the screenshot in place — same position, same modal —
 * with a crossfade; every timeframe of this trade and of its neighbours is
 * fetched ahead so the swap never waits on the network.
 */

interface Props {
  items: PlacedPosition[];
  index: number;
  onIndex(index: number): void;
  onClose(): void;
  /** Space is held: the viewer lets go of the pointer so the canvas can be dragged. */
  peek: boolean;
}

const preloaded = new Set<string>();
function preload(url: string) {
  if (preloaded.has(url)) return;
  preloaded.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

export function PositionViewer({ items, index, onIndex, onClose, peek }: Props) {
  const item = items[index];
  const [wanted, setWanted] = useState<Timeframe>('15m');
  const [fullscreen, setFullscreen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const position = item?.position;
  const tf = position ? pickTimeframe(position, wanted) : null;
  const frame = position && tf ? position.frames[tf] : undefined;

  // Opening always starts on 15M (the viewer mounts fresh each time); moving to
  // a neighbour keeps the chosen timeframe where that trade has it.

  useEffect(() => {
    for (const i of [index, index + 1, index - 1, index + 2]) {
      const p = items[i]?.position;
      if (!p) continue;
      for (const t of TIMEFRAMES) {
        const f = p.frames[t];
        if (f) preload(f.full);
      }
    }
  }, [index, items]);

  const prev = index > 0 ? index - 1 : null;
  const next = index < items.length - 1 ? index + 1 : null;

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

  if (!item || !position || !frame || !tf) return null;
  const name = item.category.name;

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
      <div ref={modalRef} className={`bv-modal${fullscreen ? ' is-fullscreen' : ''}`}>
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
            if (!f) return null;
            return (
              <img
                key={t}
                src={f.full}
                alt={`${name} · ${TIMEFRAME_LABEL[t]}`}
                className={t === tf ? 'is-shown' : undefined}
                draggable={false}
                decoding="async"
              />
            );
          })}
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
