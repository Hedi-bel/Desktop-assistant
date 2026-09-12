import { Platform } from './types';

/** Character dimensions (placeholder chibi) */
export const CHAR_WIDTH = 48;
export const CHAR_HEIGHT = 64;

/** Physics constants */
const GRAVITY = 980;           // px/s²
const WALK_SPEED = 60;         // px/s
const IDLE_MIN_MS = 500;       // minimum idle time before walking
const IDLE_MAX_MS = 2500;      // maximum idle time before walking
const MAX_FALL_SPEED = 700;    // px/s terminal fall speed
const AIR_DRAG = 2.5;          // 1/s damping while airborne

export type PetState = 'idle' | 'walk' | 'fall' | 'land';

export interface CharacterState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: PetState;
  currentPlatform: Platform | null;
  targetX: number;
  facing: 1 | -1;             // 1 = right, -1 = left
  idleTimer: number;           // ms remaining in idle state
  landTimer: number;           // ms remaining in land animation
  /** When true, physics updates are skipped (except gravity while falling). */
  paused: boolean;
}

/** Create initial character state — starts falling from top-center */
export function createCharacter(screenWidth: number): CharacterState {
  return {
    x: screenWidth / 2,
    y: 0,
    vx: 0,
    vy: 0,
    state: 'fall',
    currentPlatform: null,
    targetX: screenWidth / 2,
    facing: 1,
    idleTimer: 0,
    landTimer: 0,
    paused: false,
  };
}

/** Check if the character's feet (bottom center) can land on a platform */
function canLandOn(charX: number, charY: number, charPrevY: number, platform: Platform): boolean {
  const feetY = charY + CHAR_HEIGHT;
  const prevFeetY = charPrevY + CHAR_HEIGHT;
  const charCenterX = charX + CHAR_WIDTH / 2;
  
  // Character's center must be horizontally within the platform
  const onPlatformX = charCenterX >= platform.x && charCenterX <= platform.x + platform.width;
  
  // Feet must have crossed or reached the platform Y (falling downward through it)
  const crossedY = prevFeetY <= platform.y && feetY >= platform.y;
  // Or feet are very close (within a few pixels)
  const nearY = Math.abs(feetY - platform.y) < 5;
  
  return onPlatformX && (crossedY || (nearY && feetY >= platform.y));
}

/** Check if the character is still supported by its current platform */
function isOnPlatform(char: CharacterState, platform: Platform): boolean {
  const charCenterX = char.x + CHAR_WIDTH / 2;
  return (
    charCenterX >= platform.x &&
    charCenterX <= platform.x + platform.width
  );
}

/** Find the best platform to land on (the first one below or at the character) */
function findLandingPlatform(char: CharacterState, prevY: number, platforms: Platform[]): Platform | null {
  const feetY = char.y + CHAR_HEIGHT;
  
  // Find platforms that the character can land on, sorted by distance
  let best: Platform | null = null;
  let bestDist = Infinity;
  
  for (const p of platforms) {
    if (canLandOn(char.x, char.y, prevY, p)) {
      const dist = Math.abs(feetY - p.y);
      if (dist < bestDist) {
        best = p;
        bestDist = dist;
      }
    }
  }
  
  return best;
}

/** Pick a random target X within the bounds of a platform */
function randomTargetOnPlatform(platform: Platform): number {
  const margin = CHAR_WIDTH / 2;
  const minX = platform.x + margin;
  const maxX = platform.x + platform.width - margin;
  if (maxX <= minX) return platform.x + platform.width / 2 - CHAR_WIDTH / 2;
  return minX + Math.random() * (maxX - minX) - CHAR_WIDTH / 2;
}

/** Random idle duration */
function randomIdleTime(): number {
  return IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
}

/** Depth of the lowest platform top edge — the "floor" of the world. */
function worldFloor(platforms: Platform[]): number {
  let floor = -Infinity;
  for (const p of platforms) {
    floor = Math.max(floor, p.y);
  }
  return floor;
}

/** Place the character safely back on-screen, on the topmost platform if any. */
function respawnCharacter(char: CharacterState, platforms: Platform[]): void {
  char.vy = 0;
  char.vx = 0;
  let topmost: Platform | null = null;
  for (const p of platforms) {
    if (!topmost || p.y < topmost.y) topmost = p;
  }
  if (topmost) {
    const minX = topmost.x + CHAR_WIDTH / 2;
    const maxX = topmost.x + topmost.width - CHAR_WIDTH * 1.5;
    char.x = maxX > minX ? minX + Math.random() * (maxX - minX) : topmost.x;
    char.y = topmost.y - CHAR_HEIGHT - 2;
    char.currentPlatform = topmost;
  } else {
    char.y = -CHAR_HEIGHT;
    char.currentPlatform = null;
  }
  char.state = 'fall';
}

/**
 * Main physics update — called every frame.
 * @param char - mutable character state
 * @param dt - delta time in seconds
 * @param platforms - current platform list from latest desktop snapshot
 * @param screenHeight - screen height for out-of-bounds check
 */
export function updatePhysics(
  char: CharacterState,
  dt: number,
  platforms: Platform[],
  screenHeight: number
): void {
  // Clamp dt to avoid huge jumps (e.g. when tab is backgrounded)
  dt = Math.min(dt, 0.1);
  const dtMs = dt * 1000;

  // ── Pause guard ──
  // When paused and grounded, skip all AI/animation updates entirely.
  // When paused but mid-air (fall), still apply gravity so the pet lands
  // naturally rather than floating — once it lands the pause keeps it still.
  if (char.paused) {
    if (char.state === 'fall') {
      const prevY = char.y;
      char.vy += GRAVITY * dt;
      char.y += char.vy * dt;
      const landing = findLandingPlatform(char, prevY, platforms);
      if (landing) {
        char.y = landing.y - CHAR_HEIGHT;
        char.vy = 0;
        char.currentPlatform = landing;
        // Settle into idle so resuming from a paused-while-falling state works cleanly
        char.state = 'idle';
        char.idleTimer = 9999999; // effectively infinite until unpaused
      }
      const floor = worldFloor(platforms);
      if (char.y > screenHeight + 100 || (floor > -Infinity && char.y + CHAR_HEIGHT > floor)) {
        respawnCharacter(char, platforms);
      }
    }
    // For idle / walk / land: do nothing — pet is frozen.
    return;
  }

  switch (char.state) {
    case 'idle': {
      // Validate current platform still exists
      if (!char.currentPlatform || !platformStillExists(char.currentPlatform, platforms)) {
        char.currentPlatform = null;
        char.state = 'fall';
        char.vy = 0;
        break;
      }
      // Check we're still on the platform horizontally
      if (!isOnPlatform(char, char.currentPlatform)) {
        char.currentPlatform = null;
        char.state = 'fall';
        char.vy = 0;
        break;
      }
      
      char.idleTimer -= dtMs;
      if (char.idleTimer <= 0) {
        // Pick a new walk target
        char.targetX = randomTargetOnPlatform(char.currentPlatform);
        char.facing = char.targetX > char.x ? 1 : -1;
        char.state = 'walk';
      }
      break;
    }
    
    case 'walk': {
      // Validate current platform still exists
      if (!char.currentPlatform || !platformStillExists(char.currentPlatform, platforms)) {
        char.currentPlatform = null;
        char.state = 'fall';
        char.vy = 0;
        break;
      }
      
      const dx = char.targetX - char.x;
      const dir = Math.sign(dx);
      char.facing = dir >= 0 ? 1 : -1;
      
      const step = WALK_SPEED * dt;
      
      if (Math.abs(dx) <= step) {
        // Arrived at target
        char.x = char.targetX;
        char.state = 'idle';
        char.idleTimer = randomIdleTime();
      } else {
        char.x += dir * step;
      }
      
      // Keep on platform surface
      char.y = char.currentPlatform.y - CHAR_HEIGHT;
      
      // Check still on platform
      if (!isOnPlatform(char, char.currentPlatform)) {
        // Walked off the edge — fall
        char.currentPlatform = null;
        char.state = 'fall';
        char.vy = 0;
      }
      break;
    }
    
    case 'fall': {
      const prevY = char.y;
      char.vy += GRAVITY * dt;
      char.vy = Math.min(char.vy, MAX_FALL_SPEED);
      char.y += char.vy * dt;
      char.x += char.vx * dt;
      const decay = Math.max(0, 1 - AIR_DRAG * dt);
      char.vx *= decay;
      char.vy *= decay;

      // Check for landing on any platform
      const landing = findLandingPlatform(char, prevY, platforms);
      if (landing) {
        char.y = landing.y - CHAR_HEIGHT;
        char.vy = 0;
        char.currentPlatform = landing;
        if (Math.abs(char.vx) > 60) {
          // Carry the throw's horizontal momentum: glide forward along the platform
          const glide = Math.sign(char.vx) * Math.max(Math.abs(char.vx) * 0.6, 120);
          char.targetX = char.x + glide;
          char.facing = glide >= 0 ? 1 : -1;
          char.vx = 0;
          char.state = 'walk';
        } else {
          char.vx = 0;
          char.state = 'land';
          char.landTimer = 150; // brief land squash animation (ms)
        }
      }
      
      // If fallen below the platform floor or screen, respawn on the topmost platform
      const floor = worldFloor(platforms);
      if (char.y > screenHeight + 100 || (floor > -Infinity && char.y + CHAR_HEIGHT > floor)) {
        respawnCharacter(char, platforms);
      }
      break;
    }
    
    case 'land': {
      char.landTimer -= dtMs;
      if (char.landTimer <= 0) {
        char.state = 'idle';
        char.idleTimer = randomIdleTime();
      }
      break;
    }
  }
}

/** Check if a platform from the previous snapshot still exists in the current one */
function platformStillExists(platform: Platform, currentPlatforms: Platform[]): boolean {
  // Match by approximate position (within 10px tolerance) and similar width
  return currentPlatforms.some(p => 
    Math.abs(p.x - platform.x) < 10 &&
    Math.abs(p.y - platform.y) < 10 &&
    Math.abs(p.width - platform.width) < 10
  );
}

/** Update the character's current platform reference to the matching one in the new platform list */
export function refreshPlatformReference(char: CharacterState, platforms: Platform[]): void {
  if (!char.currentPlatform) return;
  
  const match = platforms.find(p =>
    Math.abs(p.x - char.currentPlatform!.x) < 10 &&
    Math.abs(p.y - char.currentPlatform!.y) < 10 &&
    Math.abs(p.width - char.currentPlatform!.width) < 10
  );
  
  if (match) {
    // Platform moved slightly — update reference and snap character to new position
    char.currentPlatform = match;
    // Keep the character on top of the platform
    char.y = match.y - CHAR_HEIGHT;
  } else {
    // Platform gone — fall
    char.currentPlatform = null;
    if (char.state === 'idle' || char.state === 'walk') {
      char.state = 'fall';
      char.vy = 0;
    }
  }
}
