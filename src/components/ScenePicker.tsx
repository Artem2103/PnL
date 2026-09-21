import { memo, useEffect, useRef } from 'react';
import { SCENES, drawScene, sceneById } from '../lib/canvas/scenes';
import { CARD } from '../lib/canvas/spec';

/**
 * The built-in backgrounds, each tile painted by the scene itself at the card's
 * own aspect ratio. Like `FramePicker`, there is no second drawing of anything
 * to keep in step: the tile is the artwork, scaled down.
 */
const TILE_W = 104;
const TILE_H = Math.round((TILE_W * CARD.height) / CARD.width);

const SceneTile = memo(function SceneTile({ sceneId }: { sceneId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const scene = sceneById(sceneId);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = TILE_W * dpr;
    canvas.height = TILE_H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, TILE_W, TILE_H);
    if (!scene) return;
    // Painted in design units and scaled down, so the tile is the whole card's
    // composition rather than a crop of it.
    ctx.save();
    ctx.scale(TILE_W / CARD.width, TILE_H / CARD.height);
    drawScene(ctx, CARD.width, CARD.height, scene);
    ctx.restore();
  }, [sceneId]);

  return (
    <canvas
      ref={ref}
      className="scene-swatch__tile"
      style={{ width: TILE_W, height: TILE_H }}
      aria-hidden
    />
  );
});

export interface ScenePickerProps {
  value: string | null;
  onChange: (sceneId: string | null) => void;
}

export function ScenePicker({ value, onChange }: ScenePickerProps) {
  return (
    <div className="scene-grid" role="radiogroup" aria-label="Built-in background">
      <button
        type="button"
        role="radio"
        aria-checked={!value}
        className={`scene-swatch${!value ? ' is-selected' : ''}`}
        onClick={() => onChange(null)}
      >
        <span className="scene-swatch__none" style={{ width: TILE_W, height: TILE_H }}>
          None
        </span>
        <span className="scene-swatch__name">Plain</span>
      </button>
      {SCENES.map((scene) => (
        <button
          key={scene.id}
          type="button"
          role="radio"
          aria-checked={value === scene.id}
          className={`scene-swatch${value === scene.id ? ' is-selected' : ''}`}
          onClick={() => onChange(scene.id)}
          title={scene.blurb}
        >
          <SceneTile sceneId={scene.id} />
          <span className="scene-swatch__name">{scene.name}</span>
        </button>
      ))}
    </div>
  );
}
