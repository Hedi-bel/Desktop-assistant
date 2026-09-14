import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildPlatforms } from './types';
import type { DesktopSnapshot } from './types';

function snapshot(overrides: Partial<DesktopSnapshot> = {}): DesktopSnapshot {
  return { windows: [], taskbar: null, ...overrides };
}

function stubWindow(dpr: number, screenX: number, screenY: number): void {
  vi.stubGlobal('window', { devicePixelRatio: dpr, screenX, screenY });
}

beforeAll(() => stubWindow(1, 0, 0));
afterAll(() => vi.unstubAllGlobals());

describe('buildPlatforms', () => {
  it('converts window top edges to platforms, sorted by Y', () => {
    const snap = snapshot({
      windows: [
        { title: 'Editor', x: 0, y: 200, w: 800, h: 600 },
        { title: 'A', x: 100, y: 100, w: 300, h: 200 },
      ],
      taskbar: { title: 'taskbar', x: 0, y: 1000, w: 1920, h: 48 },
    });

    const platforms = buildPlatforms(snap);

    expect(platforms.map((p) => p.y)).toEqual([100, 200, 1000]);
    expect(platforms.map((p) => p.id)).toEqual(['win:A', 'win:Editor', 'taskbar']);
  });

  it('filters out windows below the minimum width', () => {
    const snap = snapshot({
      windows: [
        { title: 'narrow', x: 0, y: 0, w: 40, h: 100 },
        { title: 'ok', x: 0, y: 100, w: 100, h: 100 },
      ],
    });

    const platforms = buildPlatforms(snap);

    expect(platforms).toHaveLength(1);
    expect(platforms[0].id).toBe('win:ok');
  });

  it('applies device pixel ratio and window offset scaling', () => {
    stubWindow(2, 10, 20);
    const snap = snapshot({ windows: [{ title: 'W', x: 100, y: 200, w: 500, h: 400 }] });

    const platforms = buildPlatforms(snap);

    expect(platforms[0]).toEqual({ id: 'win:W', x: 40, y: 80, width: 250 });
  });

  it('omits the floor platform when there is no taskbar', () => {
    const snap = snapshot({ windows: [{ title: 'T', x: 0, y: 0, w: 200, h: 200 }] });

    const platforms = buildPlatforms(snap);

    expect(platforms).toHaveLength(1);
    expect(platforms[0].id).toBe('win:T');
  });
});