import { Assets, Rectangle, Texture } from 'pixi.js';
import { CHAR_HEIGHT, CHAR_WIDTH } from './physics';
import type { PetState } from './physics';

import idleUrl from './assets/idle.png';
import walkUrl from './assets/walk.png';
import fallUrl from './assets/fall.png';
import landUrl from './assets/land.png';
import sleepingUrl from './assets/sleeping.png';
import lovableUrl from './assets/lovable.png';

export interface ClipDef {
  frames: number;
  fps: number;
  loop: boolean;
}

interface SheetDef {
  url: string;
  rows: [number, number];
  cols: [number, number][];
}

export const FRAME_RECTS: Record<PetState, SheetDef> = {
  idle: { url: idleUrl, rows: [73, 713], cols: [[120, 403], [603, 907], [1116, 1412], [1621, 1908]] },
  walk: { url: walkUrl, rows: [89, 709], cols: [[114, 452], [638, 986], [1117, 1448], [1630, 1981]] },
  fall: { url: fallUrl, rows: [113, 769], cols: [[31, 649], [658, 1141], [1196, 1731]] },
  land: { url: landUrl, rows: [50, 732], cols: [[195, 658], [833, 1225], [1488, 1845]] },
  sleep: { url: sleepingUrl, rows: [106, 757], cols: [[73, 432], [545, 923], [1019, 1396], [1497, 1919]] },
  love: { url: lovableUrl, rows: [33, 685], cols: [[13, 388], [427, 815], [855, 1247], [1325, 1700], [1770, 2128]] },
};

const BASE_STATES: PetState[] = ['idle', 'walk', 'fall', 'land'];

export const STATE_CLIPS: Record<PetState, ClipDef> = {
  idle: { frames: 4, fps: 6, loop: true },
  walk: { frames: 4, fps: 11, loop: true },
  fall: { frames: 3, fps: 7, loop: true },
  land: { frames: 3, fps: 10, loop: false },
  sleep: { frames: 4, fps: 4, loop: true },
  love: { frames: 5, fps: 8, loop: false },
};

/** Reference art height for scale matching (average of the base sheets). */
const REF_FRAME_H = (() => {
  let total = 0;
  for (const state of BASE_STATES) {
    const [lo, hi] = FRAME_RECTS[state].rows;
    total += hi - lo + 1;
  }
  return total / BASE_STATES.length;
})();

/** Per-clip scale relative to the base character size (1 for base sheets). */
export function clipScale(state: PetState): number {
  const [lo, hi] = FRAME_RECTS[state].rows;
  return REF_FRAME_H / (hi - lo + 1);
}

export const CHAR_SCALE = (() => {
  let maxW = 0;
  let maxH = 0;
  for (const state of BASE_STATES) {
    const sheet = FRAME_RECTS[state];
    for (const [l, r] of sheet.cols) {
      maxW = Math.max(maxW, r - l + 1);
    }
    maxH = Math.max(maxH, sheet.rows[1] - sheet.rows[0] + 1);
  }
  return Math.min(CHAR_WIDTH / maxW, CHAR_HEIGHT / maxH) * 1.3;
})();

export type CharacterClips = Record<PetState, Texture[]>;

export async function loadCharacterClips(): Promise<CharacterClips> {
  const clips = {} as CharacterClips;
  for (const state of Object.keys(STATE_CLIPS)) {
    const def = FRAME_RECTS[state as PetState];
    const texture = await Assets.load(def.url);
    texture.source.scaleMode = 'linear';
    texture.source.autoGenerateMipmaps = true;
    texture.source.update();
    const h = def.rows[1] - def.rows[0] + 1;
    clips[state as PetState] = def.cols.map(([l, r]) => {
      return new Texture({ source: texture.source, frame: new Rectangle(l, def.rows[0], r - l + 1, h) });
    });
  }
  return clips;
}