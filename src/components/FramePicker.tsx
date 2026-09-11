import { memo, useEffect, useRef } from 'react';
import { drawAvatarFrame } from '../lib/canvas/avatarFrames';
import { FRAMES } from '../lib/frames';

/**
 * Every frame's tile is painted by the renderer itself, at a size a thumb can
 * hit, around a neutral stand-in for the picture. It is the same function the
 * card calls, so what the tile shows is what the export will paint — there is
 * no second drawing of any frame to keep in step.
 */
const TILE = 64;
const SLOT = 38;
const SLOT_X = (TILE - SLOT) / 2;
/** Room above for the pin's pip and the tag's loop, which rise past the slot. */
const SLOT_Y = 20;

interface TileProps {
  frameId: string;
  frameColor: string;
  accent: string;
  ink: string;
}

const FrameTile = memo(function FrameTile({ frameId, frameColor, accent, ink }: TileProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = TILE * dpr;
    canvas.height = TILE * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, TILE, TILE);
    const picture = drawAvatarFrame(ctx, SLOT_X, SLOT_Y, SLOT, { frameId, frameColor, accent, ink });
    // A quiet stand-in for the avatar, so the frame is what the eye lands on.
    ctx.save();
    ctx.beginPath();
    if (picture.radius > 0) {
      ctx.roundRect(picture.x, picture.y, picture.size, picture.size, picture.radius);
    } else {
      ctx.rect(picture.x, picture.y, picture.size, picture.size);
    }
    const fill = ctx.createLinearGradient(picture.x, picture.y, picture.x + picture.size, picture.y + picture.size);
    fill.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
    fill.addColorStop(1, 'rgba(255, 255, 255, 0.12)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }, [frameId, frameColor, accent, ink]);

  return <canvas ref={ref} className="frame-swatch__tile" style={{ width: TILE, height: TILE }} aria-hidden />;
});

export interface FramePickerProps {
  value: string;
  frameColor: string;
  accent: string;
  ink: string;
  onChange: (frameId: string) => void;
}

export function FramePicker({ value, frameColor, accent, ink, onChange }: FramePickerProps) {
  return (
    <div className="frame-grid" role="radiogroup" aria-label="Avatar frame">
      {FRAMES.map((frame) => (
        <button
          key={frame.id}
          type="button"
          role="radio"
          aria-checked={value === frame.id}
          className={`frame-swatch${value === frame.id ? ' is-selected' : ''}`}
          onClick={() => onChange(frame.id)}
          title={frame.blurb}
        >
          <FrameTile frameId={frame.id} frameColor={frameColor} accent={accent} ink={ink} />
          <span className="frame-swatch__name">{frame.name}</span>
        </button>
      ))}
    </div>
  );
}
