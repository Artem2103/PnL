import { describe, expect, it } from 'vitest';
import { NO_SCENE, SCENES, drawScene, sceneById } from './scenes';
import { CARD } from './spec';
import type { Ctx2D } from './primitives';

/**
 * A canvas that records nothing and refuses nothing. The scenes are drawing
 * code with no return value, so what a unit test can prove is narrow but worth
 * having: every scene paints, end to end, without throwing — a bad index into a
 * face list or a colour the mixer cannot parse would otherwise only show up as
 * a blank card in front of someone.
 *
 * What it cannot tell you is whether the picture is any good. That is
 * `dev/scenes-shot.html`, and there is no substitute for looking.
 */
function stubContext(): { ctx: Ctx2D; calls: { fills: number; strokes: number } } {
  const calls = { fills: 0, strokes: 0 };
  const gradient = { addColorStop: () => {} };
  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    rect: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    clip: () => {},
    fill: () => {
      calls.fills += 1;
    },
    stroke: () => {
      calls.strokes += 1;
    },
    fillRect: () => {
      calls.fills += 1;
    },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as Ctx2D;
  return { ctx, calls };
}

describe('the built-in scenes', () => {
  it('has a unique id for every scene', () => {
    const ids = SCENES.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(NO_SCENE);
  });

  it('gives every scene a name, a blurb and three colours', () => {
    for (const scene of SCENES) {
      expect(scene.name.length).toBeGreaterThan(0);
      expect(scene.blurb.length).toBeGreaterThan(0);
      for (const colour of [scene.ground[0], scene.ground[1], scene.light, scene.rim]) {
        expect(colour).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it('resolves an id, and nothing else', () => {
    for (const scene of SCENES) expect(sceneById(scene.id)).toBe(scene);
    expect(sceneById(null)).toBeNull();
    expect(sceneById(NO_SCENE)).toBeNull();
    // A card saved with a scene that was later removed falls back to the plain
    // ground rather than to a blank card.
    expect(sceneById('no-such-scene')).toBeNull();
  });

  it('paints every scene without throwing, and paints something', () => {
    for (const scene of SCENES) {
      const { ctx, calls } = stubContext();
      expect(() => drawScene(ctx, CARD.width, CARD.height, scene)).not.toThrow();
      expect(calls.fills).toBeGreaterThan(5);
      expect(calls.strokes).toBeGreaterThan(0);
    }
  });

  it('is the same picture every time it paints', () => {
    // The scatter of motes runs off a seeded generator, not Math.random: the
    // preview, the PNG and every frame of a video export have to agree.
    const [first, second] = [stubContext(), stubContext()];
    const scene = SCENES[0];
    if (!scene) throw new Error('no scenes');
    drawScene(first.ctx, CARD.width, CARD.height, scene);
    drawScene(second.ctx, CARD.width, CARD.height, scene);
    expect(first.calls).toEqual(second.calls);
  });
});
