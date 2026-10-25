import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE_ID, NO_SCENE, SCENES, sceneById } from './scenes';
import { createDefaultState, hydrateState } from '../defaults';

describe('built-in backgrounds', () => {
  it('are five photos with their own ids', () => {
    const ids = SCENES.map((scene) => scene.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(NO_SCENE);
    for (const scene of SCENES) {
      expect(scene.name).toBeTruthy();
      expect(scene.url).toMatch(/\.jpg/);
    }
  });

  it('are found by id, and nothing else is', () => {
    for (const scene of SCENES) expect(sceneById(scene.id)).toBe(scene);
    expect(sceneById(null)).toBeNull();
    expect(sceneById(NO_SCENE)).toBeNull();
    expect(sceneById('astra')).toBeNull();
  });

  it('start a new card on the default', () => {
    expect(sceneById(DEFAULT_SCENE_ID)).not.toBeNull();
    expect(createDefaultState().artwork.sceneId).toBe(DEFAULT_SCENE_ID);
  });

  it('take over from the drawn backgrounds an old card was saved on', () => {
    expect(hydrateState({ artwork: { sceneId: 'astra' } }).artwork.sceneId).toBe(DEFAULT_SCENE_ID);
    expect(hydrateState({ artwork: { sceneId: 'blade' } }).artwork.sceneId).toBe(DEFAULT_SCENE_ID);
    // "None" stays none, and a current one stays itself.
    expect(hydrateState({ artwork: { sceneId: null } }).artwork.sceneId).toBeNull();
    expect(hydrateState({ artwork: { sceneId: 'vanish' } }).artwork.sceneId).toBe('vanish');
  });
});
