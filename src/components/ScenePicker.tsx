import { memo } from 'react';
import { SCENES } from '../lib/canvas/scenes';
import { CARD } from '../lib/canvas/spec';

/** The built-in backgrounds, as photo tiles at the card's own aspect ratio. */
const TILE_W = 104;
const TILE_H = Math.round((TILE_W * CARD.height) / CARD.width);

const SceneTile = memo(function SceneTile({ url }: { url: string }) {
  return (
    <img
      className="scene-swatch__tile"
      src={url}
      alt=""
      style={{ width: TILE_W, height: TILE_H, objectFit: 'cover' }}
      loading="lazy"
      decoding="async"
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
        >
          <SceneTile url={scene.url} />
          <span className="scene-swatch__name">{scene.name}</span>
        </button>
      ))}
    </div>
  );
}
