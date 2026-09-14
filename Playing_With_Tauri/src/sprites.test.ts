import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({
  Assets: { load: vi.fn() },
  Rectangle: class Rectangle {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
  },
  Texture: class Texture {
    source: unknown;
    frame: unknown;
    constructor(options?: { source?: unknown; frame?: unknown }) {
      this.source = options?.source;
      this.frame = options?.frame;
    }
  },
}));

import { clipScale, FRAME_RECTS } from './sprites';
import type { PetState } from './physics';

const STATES: PetState[] = ['idle', 'walk', 'fall', 'land', 'sleep', 'love'];

describe('clipScale', () => {
  it('is positive for every clip', () => {
    for (const state of STATES) {
      expect(clipScale(state)).toBeGreaterThan(0);
    }
  });

  it('renders every sheet at the same effective height', () => {
    const renderedHeights = STATES.map((state) => {
      const [lo, hi] = FRAME_RECTS[state].rows;
      return clipScale(state) * (hi - lo + 1);
    });
    const reference = renderedHeights[0];
    for (const height of renderedHeights) {
      expect(height).toBeCloseTo(reference, 6);
    }
  });

  it('scales down sheets that are taller than the reference art', () => {
    expect(clipScale('sleep')).toBeLessThan(clipScale('idle'));
    expect(clipScale('love')).toBeLessThan(clipScale('idle'));
  });

  it('stays close to 1× for all sheets', () => {
    for (const state of STATES) {
      expect(clipScale(state)).toBeGreaterThan(0.9);
      expect(clipScale(state)).toBeLessThan(1.1);
    }
  });
});