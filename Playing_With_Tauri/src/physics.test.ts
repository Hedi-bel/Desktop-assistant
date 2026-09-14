import { describe, expect, it } from 'vitest';
import { CHAR_HEIGHT, createCharacter, refreshPlatformReference, updatePhysics } from './physics';
import type { CharacterState } from './physics';
import type { Platform } from './types';

function platform(overrides: Partial<Platform> = {}): Platform {
  return { id: 'win:test', x: 50, y: 600, width: 400, ...overrides };
}

function groundedCharacter(p: Platform, overrides: Partial<CharacterState> = {}): CharacterState {
  const char = createCharacter(1600);
  char.x = p.x + p.width / 2;
  char.y = p.y - CHAR_HEIGHT;
  char.currentPlatform = p;
  char.state = 'idle';
  char.idleTimer = 0;
  Object.assign(char, overrides);
  return char;
}

describe('createCharacter', () => {
  it('starts falling from the top-center of the screen', () => {
    const char = createCharacter(1600);
    expect(char.x).toBe(800);
    expect(char.y).toBe(0);
    expect(char.state).toBe('fall');
  });
});

describe('idle → walk', () => {
  it('picks a walk target and transitions once the idle timer runs out', () => {
    const p = platform();
    const char = groundedCharacter(p, { idleTimer: 1 });

    updatePhysics(char, 0.1, [p], 1600);

    expect(char.state).toBe('walk');
    expect(char.currentPlatform).toBe(p);
    expect(char.targetX).toBeGreaterThanOrEqual(p.x);
    expect(char.targetX).toBeLessThanOrEqual(p.x + p.width);
  });
});

describe('idle → sleep', () => {
  it('falls asleep once the doze clock runs out while idle', () => {
    const p = platform();
    const char = groundedCharacter(p, { idleTimer: 10000, dozeTimer: 1 });

    updatePhysics(char, 0.1, [p], 1600);

    expect(char.state).toBe('sleep');
    expect(char.dozeTimer).toBeLessThan(0);
  });
});

describe('walk → idle', () => {
  it('arrives at the target and rests', () => {
    const p = platform();
    const char = groundedCharacter(p, { state: 'walk', targetX: 100 });
    char.x = 96;

    updatePhysics(char, 0.1, [p], 1600);

    expect(char.state).toBe('idle');
    expect(char.x).toBe(100);
    expect(char.y).toBe(p.y - CHAR_HEIGHT);
    expect(char.idleTimer).toBeGreaterThan(0);
  });
});

describe('walk → fall', () => {
  it('falls when the platform disappears mid-walk', () => {
    const p = platform();
    const char = groundedCharacter(p, { state: 'walk' });

    updatePhysics(char, 0.1, [], 1600);

    expect(char.state).toBe('fall');
    expect(char.currentPlatform).toBeNull();
    expect(char.vy).toBe(0);
  });

  it('falls when walking past the edge of a platform', () => {
    const p = platform({ width: 100 });
    const char = groundedCharacter(p, { state: 'walk', targetX: p.x + p.width });
    char.x = p.x + p.width - 10;

    updatePhysics(char, 0.1, [p], 1600);

    expect(char.state).toBe('fall');
    expect(char.currentPlatform).toBeNull();
  });
});

describe('idle → fall', () => {
  it('falls when its platform disappears while idle', () => {
    const p = platform();
    const char = groundedCharacter(p);

    updatePhysics(char, 0.1, [], 1600);

    expect(char.state).toBe('fall');
    expect(char.currentPlatform).toBeNull();
  });
});

describe('fall → land', () => {
  it('lands on a platform once the feet cross its top edge', () => {
    const p = platform({ y: 600 });
    const char = groundedCharacter(p);
    char.x = 200;
    char.y = 600 - CHAR_HEIGHT - 12;
    char.state = 'fall';
    char.vy = 0;
    char.vx = 0;

    updatePhysics(char, 0.1, [p], 1600);
    expect(char.state).toBe('fall');

    updatePhysics(char, 0.1, [p], 1600);
    expect(char.state).toBe('land');
    expect(char.y).toBe(600 - CHAR_HEIGHT);
    expect(char.currentPlatform).toBe(p);
    expect(char.landTimer).toBe(150);
    expect(char.vy).toBe(0);
  });
});

describe('land → idle', () => {
  it('holds the squash animation then returns to idle', () => {
    const p = platform();
    const char = groundedCharacter(p, { state: 'land', landTimer: 150 });

    updatePhysics(char, 0.1, [p], 1600);
    expect(char.state).toBe('land');
    expect(char.landTimer).toBe(50);

    updatePhysics(char, 0.1, [p], 1600);
    expect(char.state).toBe('idle');
    expect(char.idleTimer).toBeGreaterThan(0);
  });
});

describe('love', () => {
  it('runs for loveTimer then returns to the previous grounded state', () => {
    const p = platform();
    const char = groundedCharacter(p, { state: 'love', lovePrev: 'walk', loveTimer: 100 });

    updatePhysics(char, 0.05, [p], 1600);
    expect(char.state).toBe('love');

    updatePhysics(char, 0.05, [p], 1600);
    expect(char.state).toBe('walk');
    expect(char.lovePrev).toBe('idle');
  });
});

describe('refreshPlatformReference', () => {
  it('re-points the platform reference when it moves slightly', () => {
    const oldP = platform({ x: 50 });
    const movedP = platform({ x: 55 });
    const char = groundedCharacter(oldP);

    refreshPlatformReference(char, [movedP]);

    expect(char.currentPlatform).toBe(movedP);
    expect(char.y).toBe(movedP.y - CHAR_HEIGHT);
  });

  it('drops to fall when the referenced platform disappears', () => {
    const p = platform();
    const char = groundedCharacter(p, { state: 'walk' });

    refreshPlatformReference(char, []);

    expect(char.currentPlatform).toBeNull();
    expect(char.state).toBe('fall');
    expect(char.vy).toBe(0);
  });

  it('is a no-op when the character has no platform reference', () => {
    const char = createCharacter(1600);
    char.state = 'idle';

    refreshPlatformReference(char, []);

    expect(char.state).toBe('idle');
    expect(char.currentPlatform).toBeNull();
  });
});