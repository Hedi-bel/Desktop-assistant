import { Application, Graphics, Container } from 'pixi.js';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { DesktopSnapshot, buildPlatforms } from './types';
import type { Platform } from './types';
import {
  createCharacter,
  updatePhysics,
  refreshPlatformReference,
  CHAR_WIDTH,
  CHAR_HEIGHT,
} from './physics';
import type { CharacterState } from './physics';

// ── State ──
let platforms: Platform[] = [];
let character: CharacterState;
let petVisible = true;

// ── PixiJS Setup ──
const app = new Application();

// ── Rect Sync ──
// We update the backend with the character's bounding box.
// The backend uses a fast thread (60Hz) to poll GetCursorPos. If the system 
// mouse pointer enters this rect, the backend toggles ignore_cursor_events(false)
// allowing you to click the character.
const SYNC_INTERVAL_MS = 100; // 10 Hz periodic drift correction
let lastSyncX = -9999;
let lastSyncY = -9999;
let lastSyncTime = 0;

async function syncCharacterRect(charX: number, charY: number, force = false): Promise<void> {
  // Convert from CSS px (PixiJS space) to physical screen px (Tauri window position)
  const dpr = window.devicePixelRatio || 1;
  const offsetX = window.screenX || 0;
  const offsetY = window.screenY || 0;

  // Physical screen coordinates of the character's bounding box
  const physX = Math.round((charX + offsetX) * dpr);
  const physY = Math.round((charY + offsetY) * dpr);
  const physW = Math.round(CHAR_WIDTH * dpr);
  const physH = Math.round(CHAR_HEIGHT * dpr);

  // Only call if the position actually changed
  if (!force && physX === lastSyncX && physY === lastSyncY) return;

  lastSyncX = physX;
  lastSyncY = physY;

  // Non-blocking fire-and-forget
  invoke('update_character_rect', { x: physX, y: physY, w: physW, h: physH }).catch(() => {});
}

async function init() {
  await app.init({
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
  });
  
  const container = document.getElementById('app')!;
  container.appendChild(app.canvas);
  
  // Create character state
  character = createCharacter(window.innerWidth);
  
  // Create the character sprite container
  const charContainer = new Container();
  
  // Enable interaction on the character
  charContainer.eventMode = 'static';
  charContainer.cursor = 'pointer';
  charContainer.on('pointerdown', (e) => {
    // Left click only
    if (e.button === 0) {
      invoke('show_context_menu').catch(console.error);
    }
  });
  
  app.stage.addChild(charContainer);
  
  // ── Draw Placeholder Chibi ──
  const chibi = drawChibiCharacter();
  charContainer.addChild(chibi);
  
  // ── Tauri Event Listeners ──
  if ('__TAURI_INTERNALS__' in window) {
    // Initial sync
    syncCharacterRect(character.x, character.y, true).catch(() => {});

    await listen<DesktopSnapshot>('desktop-snapshot', (event) => {
      const newPlatforms = buildPlatforms(event.payload);
      platforms = newPlatforms;
      refreshPlatformReference(character, platforms);
    });

    const initialSnapshot = await invoke<DesktopSnapshot | null>('get_desktop_snapshot');
    if (initialSnapshot) {
      platforms = buildPlatforms(initialSnapshot);
      refreshPlatformReference(character, platforms);
      console.log(`[desktop-pet] seeded ${platforms.length} platform(s) from cached snapshot`);
    } else {
      console.warn('[desktop-pet] cached snapshot not ready yet; waiting for desktop-snapshot events');
    }
    
    await listen<boolean>('pet-visibility', (event) => {
      petVisible = event.payload;
      charContainer.visible = petVisible;
      
      // If hidden, push a dummy rect off-screen so you can't click an invisible pet
      if (!petVisible) {
        invoke('update_character_rect', { x: -9999, y: -9999, w: 0, h: 0 }).catch(() => {});
      } else {
        syncCharacterRect(character.x, character.y, true).catch(() => {});
      }
    });

    await listen<void>('pet-pause-toggle', () => {
      character.paused = !character.paused;
      if (!character.paused && (character.state === 'idle' || character.state === 'land')) {
        const randomIdleTimeMs = 500 + Math.random() * 2000;
        character.idleTimer = randomIdleTimeMs;
      }
      syncCharacterRect(character.x, character.y, true).catch(() => {});
    });
  } else {
    console.warn("Tauri APIs not available! It looks like you opened this in a normal web browser. The Desktop Pet requires the native Tauri window to function properly.");
  }
  
  // ── Render Loop ──
  let walkAnimTime = 0;
  
  app.ticker.add((ticker) => {
    if (!petVisible) return;
    
    const dt = ticker.deltaMS / 1000;

    const prevState = character.state;
    const prevX = character.x;
    const prevY = character.y;
    
    updatePhysics(character, dt, platforms, window.innerHeight);
    
    charContainer.x = character.x;
    charContainer.y = character.y;
    
    if (character.state === 'walk') {
      walkAnimTime += dt * 8; 
    } else {
      walkAnimTime = 0;
    }
    
    charContainer.scale.x = character.facing;
    if (character.facing === -1) {
      charContainer.x += CHAR_WIDTH; 
    }
    
    if (character.state === 'land') {
      const t = character.landTimer / 150;
      charContainer.scale.y = 1 - 0.15 * t; 
      charContainer.y += CHAR_HEIGHT * 0.15 * t; 
    } else {
      charContainer.scale.y = 1;
    }
    
    if (character.state === 'walk') {
      charContainer.y += Math.sin(walkAnimTime) * 2;
    }
    
    chibi.clear();
    drawChibiOnto(chibi, walkAnimTime, character.state);

    // ── Sync Strategy ──
    if ('__TAURI_INTERNALS__' in window) {
      const stateChanged = character.state !== prevState;
      const movedEnough = Math.abs(character.x - prevX) > 0.5 || Math.abs(character.y - prevY) > 0.5;
      const now = performance.now();
      const periodicSyncDue = movedEnough && (now - lastSyncTime >= SYNC_INTERVAL_MS);

      if (stateChanged || periodicSyncDue) {
        lastSyncTime = now;
        syncCharacterRect(character.x, character.y).catch(() => {});
      }
    }
  });
}

function drawChibiCharacter(): Graphics {
  const g = new Graphics();
  // Draw an invisible background to ensure the entire CHAR_WIDTH x CHAR_HEIGHT
  // area registers pointer events (since the character itself is small limbs/head)
  g.rect(0, 0, CHAR_WIDTH, CHAR_HEIGHT);
  g.fill({ color: 0xFFFFFF, alpha: 0.001 }); // Almost entirely transparent
  
  drawChibiOnto(g, 0, 'idle');
  return g;
}

function drawChibiOnto(g: Graphics, walkTime: number, state: string): void {
  const w = CHAR_WIDTH;
  const h = CHAR_HEIGHT;
  
  const skinColor = 0xFFDFC4;
  const hairColor = 0x4A3728;
  const bodyColor = 0xFF6B8A;
  const eyeColor = 0x2D2D2D;
  const blushColor = 0xFFAAAA;
  const shoeColor = 0x4A3728;
  
  g.beginPath();
  g.moveTo(w * 0.25, h * 0.45);
  g.lineTo(w * 0.75, h * 0.45);
  g.lineTo(w * 0.8, h * 0.72);
  g.lineTo(w * 0.2, h * 0.72);
  g.closePath();
  g.fill({ color: bodyColor });
  
  const legSwing = state === 'walk' ? Math.sin(walkTime) * 4 : 0;
  
  g.roundRect(w * 0.3 - legSwing, h * 0.7, w * 0.15, h * 0.18, 3);
  g.fill({ color: skinColor });
  g.roundRect(w * 0.28 - legSwing, h * 0.86, w * 0.19, h * 0.08, 3);
  g.fill({ color: shoeColor });
  
  g.roundRect(w * 0.55 + legSwing, h * 0.7, w * 0.15, h * 0.18, 3);
  g.fill({ color: skinColor });
  g.roundRect(w * 0.53 + legSwing, h * 0.86, w * 0.19, h * 0.08, 3);
  g.fill({ color: shoeColor });
  
  const headCX = w * 0.5;
  const headCY = h * 0.28;
  const headR = w * 0.32;
  
  g.circle(headCX, headCY, headR + 3);
  g.fill({ color: hairColor });
  
  g.circle(headCX, headCY + 2, headR - 2);
  g.fill({ color: skinColor });
  
  g.beginPath();
  g.arc(headCX, headCY - 2, headR, -Math.PI, 0);
  g.lineTo(headCX + headR - 2, headCY + 2);
  g.lineTo(headCX - headR + 2, headCY + 2);
  g.closePath();
  g.fill({ color: hairColor });
  
  g.beginPath();
  g.moveTo(headCX - headR, headCY);
  g.lineTo(headCX - headR - 4, headCY + 14);
  g.lineTo(headCX - headR + 4, headCY + 10);
  g.closePath();
  g.fill({ color: hairColor });
  
  g.beginPath();
  g.moveTo(headCX + headR, headCY);
  g.lineTo(headCX + headR + 4, headCY + 14);
  g.lineTo(headCX + headR - 4, headCY + 10);
  g.closePath();
  g.fill({ color: hairColor });
  
  const eyeY = headCY + 4;
  const eyeSpacing = w * 0.12;
  
  g.circle(headCX - eyeSpacing, eyeY, 2.5);
  g.fill({ color: eyeColor });
  g.circle(headCX - eyeSpacing + 1, eyeY - 1, 0.8);
  g.fill({ color: 0xFFFFFF });
  
  g.circle(headCX + eyeSpacing, eyeY, 2.5);
  g.fill({ color: eyeColor });
  g.circle(headCX + eyeSpacing + 1, eyeY - 1, 0.8);
  g.fill({ color: 0xFFFFFF });
  
  g.circle(headCX - eyeSpacing - 3, eyeY + 4, 3);
  g.fill({ color: blushColor, alpha: 0.4 });
  g.circle(headCX + eyeSpacing + 3, eyeY + 4, 3);
  g.fill({ color: blushColor, alpha: 0.4 });
  
  g.beginPath();
  g.arc(headCX, eyeY + 7, 2, 0, Math.PI);
  g.stroke({ color: eyeColor, width: 1 });
  
  const armSwing = state === 'walk' ? Math.sin(walkTime + Math.PI) * 3 : 0;
  
  g.roundRect(w * 0.12, h * 0.47 + armSwing, w * 0.13, h * 0.15, 3);
  g.fill({ color: skinColor });
  
  g.roundRect(w * 0.75, h * 0.47 - armSwing, w * 0.13, h * 0.15, 3);
  g.fill({ color: skinColor });
}

init().catch(console.error);
