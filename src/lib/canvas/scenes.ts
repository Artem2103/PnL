import katana from '../../assets/backgrounds/katana.jpg';
import base from '../../assets/backgrounds/base.jpg';
import bnb from '../../assets/backgrounds/bnb.jpg';
import ether from '../../assets/backgrounds/ether.jpg';
import vanish from '../../assets/backgrounds/vanish.jpg';

/**
 * The built-in backgrounds: five photos that ship with the app
 * (`src/assets/backgrounds/`, made from `reference/background-base/`).
 *
 * They are backgrounds like an uploaded photo — covered to the card, moved
 * and zoomed the same way, under the same scrim — only they need no upload.
 * `render.ts` loads the chosen one into the card's artwork slot.
 *
 * Until 2026-10-25 this file drew a sky (and before that five faceted solids)
 * on the canvas. Those were replaced on request by these photos.
 */

export interface Scene {
  id: string;
  name: string;
  url: string;
}

export const SCENES: readonly Scene[] = [
  { id: 'katana', name: 'Katana', url: katana },
  { id: 'base', name: 'Base', url: base },
  { id: 'bnb', name: 'BNB', url: bnb },
  { id: 'ether', name: 'Ether', url: ether },
  { id: 'vanish', name: 'Vanish', url: vanish },
];

/** What `artwork.sceneId` holds when the card has no built-in background. */
export const NO_SCENE = 'none';

/** The background a new card starts on. */
export const DEFAULT_SCENE_ID = 'katana';

export function sceneById(id: string | null | undefined): Scene | null {
  if (!id || id === NO_SCENE) return null;
  return SCENES.find((scene) => scene.id === id) ?? null;
}

const loaded = new Map<string, Promise<HTMLImageElement | null>>();

/** The scene's photo, decoded once and shared by every card. */
export function loadScene(scene: Scene): Promise<HTMLImageElement | null> {
  let pending = loaded.get(scene.id);
  if (!pending) {
    pending = new Promise((done) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => done(img);
      img.onerror = () => {
        loaded.delete(scene.id);
        done(null);
      };
      img.src = scene.url;
    });
    loaded.set(scene.id, pending);
  }
  return pending;
}
