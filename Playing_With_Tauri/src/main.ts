import { Application, AnimatedSprite, Container, Rectangle, Ticker } from 'pixi.js';
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
  SLEEP_AFTER_MS,
} from './physics';
import type { CharacterState } from './physics';
import { STATE_CLIPS, CHAR_SCALE, clipScale, loadCharacterClips } from './sprites';
import type { CharacterClips } from './sprites';
import { trimReply, CHAT_HISTORY_LIMIT } from './chat';
import type { ChatMsg } from './chat';
import cuteIconUrl from './assets/cute_icon.jpg';
import respawnIconUrl from './assets/respawn_icon.png';

// ── State ──
let platforms: Platform[] = [];
let charContainer: Container;
let character: CharacterState;
let petVisible = true;
let clips: CharacterClips;
let chibiSprite: AnimatedSprite;
let lastAnimatedState: CharacterState['state'] | null = null;

// ── Drag & Drop ──
const DRAG_HISTORY_MS = 120;
let dragging = false;
let pressMoved = false;
let grabDX = 0;
let grabDY = 0;
let dragStartX = 0;
let dragStartY = 0;
let dragHistory: { x: number; y: number; t: number }[] = [];

// ── Bubble Mode ──
const BUBBLE_SIZE = 56;
const CLOSE_ZONE_SIZE = 56;
const LOVE_MS = (STATE_CLIPS.love.frames / STATE_CLIPS.love.fps) * 1000;
let closeZoneEl: HTMLDivElement;
let closeZoneArmed = false;
let bubbleMode = false;
let bubbleEl: HTMLDivElement;
let bubbleImg: HTMLImageElement;
let bubbleDragging = false;
let bubblePressMoved = false;
let bubbleGrabDX = 0;
let bubbleGrabDY = 0;
let bubbleDragStartX = 0;
let bubbleDragStartY = 0;
let lastBubbleSyncX = -9999;
let lastBubbleSyncY = -9999;
let lastBubbleSyncTime = 0;

// ── Chat Mode ──
const DEFAULT_CHAT_W = 320;
const DEFAULT_CHAT_H = 400;
const MIN_CHAT_W = 240;
const MIN_CHAT_H = 320;
let chatW = DEFAULT_CHAT_W;
let chatH = DEFAULT_CHAT_H;
let chatMode = false;
let chatEl: HTMLDivElement;
let chatAvatar: HTMLImageElement;
let chatBody: HTMLDivElement;
let chatInput: HTMLInputElement;
let chatSend: HTMLButtonElement;
let chatHeader: HTMLDivElement;
let chatCloseBtn: HTMLButtonElement;
let chatRespawnBtn: HTMLButtonElement;
let chatDragging = false;
let chatPressMoved = false;
let chatClosePress = false;
let chatRespawnPress = false;
let chatResizing = false;
let chatResizeCorner: 'se' | 'sw' | 'ne' | 'nw' = 'se';
let chatResizeStartX = 0;
let chatResizeStartY = 0;
let chatStartLeft = 0;
let chatStartTop = 0;
let chatStartW = DEFAULT_CHAT_W;
let chatStartH = DEFAULT_CHAT_H;
let chatStartRight = 0;
let chatStartBottom = 0;
let chatGrabDX = 0;
let chatGrabDY = 0;
let chatDragStartX = 0;
let chatDragStartY = 0;
let lastChatSyncX = -9999;
let lastChatSyncY = -9999;
let lastChatSyncTime = 0;
let chatHistory: ChatMsg[] = [];
let chatPending = false;

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

function visibleBottom(): number {
  let floor = -Infinity;
  for (const p of platforms) {
    floor = Math.max(floor, p.y);
  }
  return Number.isFinite(floor) ? floor : window.innerHeight;
}

function pickBubbleIcon(): void {
  bubbleImg.src = cuteIconUrl;
}

function positionCloseZone(): void {
  if (!closeZoneEl) return;
  closeZoneEl.style.left = `${(window.innerWidth - CLOSE_ZONE_SIZE) / 2}px`;
  closeZoneEl.style.top = `${visibleBottom() - CLOSE_ZONE_SIZE - 12}px`;
}

function setCloseZoneArmed(armed: boolean): void {
  if (!closeZoneEl || armed === closeZoneArmed) return;
  closeZoneArmed = armed;
  closeZoneEl.classList.toggle('armed', armed);
}

function overCloseZone(el: HTMLElement): boolean {
  if (!closeZoneEl) return false;
  const a = el.getBoundingClientRect();
  const b = closeZoneEl.getBoundingClientRect();
  const aCx = a.left + a.width / 2;
  const aCy = a.top + a.height / 2;
  return aCx >= b.left && aCx <= b.right && aCy >= b.top && aCy <= b.bottom;
}

function syncBubbleRect(force = false): void {
  if (!bubbleEl) return;
  const rect = bubbleEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const offsetX = window.screenX || 0;
  const offsetY = window.screenY || 0;

  const physX = Math.round((rect.left + offsetX) * dpr);
  const physY = Math.round((rect.top + offsetY) * dpr);
  const physW = Math.round(rect.width * dpr);
  const physH = Math.round(rect.height * dpr);

  if (!force && physX === lastBubbleSyncX && physY === lastBubbleSyncY) return;
  lastBubbleSyncX = physX;
  lastBubbleSyncY = physY;

  invoke('update_character_rect', { x: physX, y: physY, w: physW, h: physH }).catch(() => {});
}

// ── Chat Helpers ──
function openChat(): void {
  chatMode = true;
  bubbleEl.classList.remove('visible');
  chatAvatar.src = bubbleImg.src || cuteIconUrl;
  chatEl.style.left = `${Math.max(window.innerWidth - chatW - 16, 0)}px`;
  chatEl.style.top = `${Math.min(Math.max(visibleBottom() - chatH - 16, 0), window.innerHeight - chatH)}px`;
  chatEl.style.width = `${chatW}px`;
  chatEl.style.height = `${chatH}px`;
  chatEl.classList.add('visible');
  lastChatSyncX = -9999;
  lastChatSyncY = -9999;
  syncChatRect(true);
  chatInput.focus();
}

function closeChat(): void {
  chatMode = false;
  chatEl.classList.remove('visible');
  bubbleEl.classList.add('visible');
  lastBubbleSyncX = -9999;
  lastBubbleSyncY = -9999;
  syncBubbleRect(true);
}

function wakePet(): void {
  character.dozeTimer = SLEEP_AFTER_MS;
  if (character.state === 'sleep') {
    character.state = 'idle';
    character.idleTimer = 800 + Math.random() * 1200;
  }
}

function respawnPet(): void {
  bubbleMode = false;
  petVisible = true;
  charContainer.visible = true;
  bubbleEl.classList.remove('visible');
  closeZoneEl.classList.remove('visible');
  setCloseZoneArmed(false);
  if (chatMode) {
    chatMode = false;
    chatEl.classList.remove('visible');
  }
  chibiSprite.play();
  character.vx = 0;
  character.vy = 0;
  character.landTimer = 0;
  character.idleTimer = 0;
  character.x = Math.max(Math.min((window.innerWidth - CHAR_WIDTH) / 2, window.innerWidth - CHAR_WIDTH), 0);
  character.y = 0;
  character.state = 'fall';
  lastSyncX = character.x;
  lastSyncY = character.y;
  syncCharacterRect(character.x, character.y, true).catch(() => {});
}

function syncChatRect(force = false): void {
  if (!chatEl) return;
  const rect = chatEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const offsetX = window.screenX || 0;
  const offsetY = window.screenY || 0;

  const physX = Math.round((rect.left + offsetX) * dpr);
  const physY = Math.round((rect.top + offsetY) * dpr);
  const physW = Math.round(rect.width * dpr);
  const physH = Math.round(rect.height * dpr);

  if (!force && physX === lastChatSyncX && physY === lastChatSyncY) return;
  lastChatSyncX = physX;
  lastChatSyncY = physY;

  invoke('update_character_rect', { x: physX, y: physY, w: physW, h: physH }).catch(() => {});
}

function appendMessage(role: ChatMsg['role'], text: string): void {
  const row = document.createElement('div');
  row.className = `chat-row ${role}`;
  if (role === 'assistant') {
    const avatar = document.createElement('img');
    avatar.className = 'chat-msg-avatar';
    avatar.src = chatAvatar.src;
    row.appendChild(avatar);
  }
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = text;
  row.appendChild(bubble);
  chatBody.appendChild(row);
  chatBody.scrollTop = chatBody.scrollHeight;
}

function setTyping(on: boolean): void {
  let typingRow = chatBody.querySelector('.chat-row.pet.typing') as HTMLDivElement | null;
  if (on && !typingRow) {
    typingRow = document.createElement('div');
    typingRow.className = 'chat-row pet typing';
    const avatar = document.createElement('img');
    avatar.className = 'chat-msg-avatar';
    avatar.src = chatAvatar.src;
    typingRow.appendChild(avatar);
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = '…';
    typingRow.appendChild(bubble);
    chatBody.appendChild(typingRow);
    chatBody.scrollTop = chatBody.scrollHeight;
  } else if (!on && typingRow) {
    typingRow.remove();
  }
}

async function sendMessage(): Promise<void> {
  const text = chatInput.value.trim();
  if (!text || chatPending) return;
  chatInput.value = '';
  appendMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  chatHistory = chatHistory.slice(-CHAT_HISTORY_LIMIT);
  chatPending = true;
  chatSend.disabled = true;
  setTyping(true);
  try {
    const reply = trimReply(await invoke<string>('chat_message', { messages: chatHistory }));
    chatHistory.push({ role: 'assistant', content: reply });
    chatHistory = chatHistory.slice(-CHAT_HISTORY_LIMIT);
    setTyping(false);
    appendMessage('assistant', reply);
  } catch (err) {
    setTyping(false);
    appendMessage('assistant', String(err));
  } finally {
    chatPending = false;
    chatSend.disabled = false;
    chatInput.focus();
  }
}

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
    autoStart: false,
  });
  
  const container = document.getElementById('app')!;
  container.appendChild(app.canvas);
  app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── Bubble Element ──
  bubbleEl = document.createElement('div');
  bubbleEl.className = 'bubble';
  bubbleImg = document.createElement('img');
  bubbleEl.appendChild(bubbleImg);
  container.appendChild(bubbleEl);

  // ── Close Zone Element ──
  closeZoneEl = document.createElement('div');
  closeZoneEl.className = 'close-zone';
  closeZoneEl.textContent = '✕';
  container.appendChild(closeZoneEl);
  positionCloseZone();

  // ── Chat Element ──
  chatEl = document.createElement('div');
  chatEl.className = 'chat';
  chatHeader = document.createElement('div');
  chatHeader.className = 'chat-header';
  chatAvatar = document.createElement('img');
  chatAvatar.className = 'chat-avatar';
  chatHeader.appendChild(chatAvatar);
  const chatTitle = document.createElement('div');
  chatTitle.className = 'chat-header-title';
  chatTitle.textContent = 'Frieren-Assistant';
  chatHeader.appendChild(chatTitle);
  chatRespawnBtn = document.createElement('button');
  chatRespawnBtn.className = 'chat-respawn';
  chatRespawnBtn.title = 'Respawn pet';
  const respawnImg = document.createElement('img');
  respawnImg.src = respawnIconUrl;
  respawnImg.alt = '';
  chatRespawnBtn.appendChild(respawnImg);
  chatHeader.appendChild(chatRespawnBtn);
  chatCloseBtn = document.createElement('button');
  chatCloseBtn.className = 'chat-close';
  chatCloseBtn.textContent = '✕';
  chatHeader.appendChild(chatCloseBtn);
  chatBody = document.createElement('div');
  chatBody.className = 'chat-body';
  const chatInputBar = document.createElement('div');
  chatInputBar.className = 'chat-input';
  chatInput = document.createElement('input');
  chatInput.placeholder = 'Type a message…';
  chatSend = document.createElement('button');
  chatSend.className = 'chat-send';
  chatSend.textContent = '➤';
  chatInputBar.appendChild(chatInput);
  chatInputBar.appendChild(chatSend);
  chatEl.appendChild(chatHeader);
  chatEl.appendChild(chatBody);
  chatEl.appendChild(chatInputBar);
  const resizeCorners: Array<'se' | 'sw' | 'ne' | 'nw'> = ['se', 'sw', 'ne', 'nw'];
  for (const corner of resizeCorners) {
    const handle = document.createElement('div');
    handle.className = `chat-resize ${corner}`;
    chatEl.appendChild(handle);
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      chatResizing = true;
      chatResizeCorner = corner;
      chatResizeStartX = e.clientX;
      chatResizeStartY = e.clientY;
      const rect = chatEl.getBoundingClientRect();
      chatStartLeft = rect.left;
      chatStartTop = rect.top;
      chatStartW = rect.width;
      chatStartH = rect.height;
      chatStartRight = rect.left + rect.width;
      chatStartBottom = rect.top + rect.height;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture unavailable; resize still works while inside the window
      }
    });
  }
  container.appendChild(chatEl);
  
  // Create character state
  character = createCharacter(window.innerWidth);
  
  // Create the character sprite container
  charContainer = new Container();
  
  // Enable interaction on the character
  charContainer.eventMode = 'static';
  charContainer.cursor = 'pointer';
  charContainer.hitArea = new Rectangle(0, 0, CHAR_WIDTH, CHAR_HEIGHT);
  charContainer.on('pointerdown', (e) => {
    // Left button only
    if (e.button === 0) {
      wakePet();
      dragging = true;
      pressMoved = false;
      const mx = e.global.x;
      const my = e.global.y;
      grabDX = mx - character.x;
      grabDY = my - character.y;
      dragStartX = mx;
      dragStartY = my;
      dragHistory = [{ x: mx, y: my, t: performance.now() }];
      try {
        app.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture unavailable; drag still works while inside the window
      }
    } else if (e.button === 2) {
      if (!dragging && character.state !== 'fall' && character.state !== 'love') {
        character.lovePrev = character.state;
        character.loveTimer = LOVE_MS;
        character.dozeTimer = SLEEP_AFTER_MS;
        character.state = 'love';
      }
    }
  });
  
  app.stage.addChild(charContainer);
  
  // ── Character Sprite ──
  clips = await loadCharacterClips();
  const sprite = new AnimatedSprite(clips.idle);
  sprite.anchor.set(0.5, 1);
  sprite.scale.set(CHAR_SCALE);
  const vis = new Container();
  vis.addChild(sprite);
  charContainer.addChild(vis);
  chibiSprite = sprite;
  setStateAnimation(character.state);
  
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
      } else if (!bubbleMode) {
        syncCharacterRect(character.x, character.y, true).catch(() => {});
      }
    });

    await listen<void>('pet-bubble-toggle', () => {
      bubbleMode = true;
      petVisible = false;
      charContainer.visible = false;
      lastBubbleSyncX = -9999;
      lastBubbleSyncY = -9999;
      pickBubbleIcon();
      bubbleEl.style.left = `${Math.max(window.innerWidth - BUBBLE_SIZE - 32, 0)}px`;
      bubbleEl.style.top = `${Math.min(window.innerHeight * 0.4, visibleBottom() - BUBBLE_SIZE)}px`;
      bubbleEl.classList.add('visible');
      syncBubbleRect(true);
    });
  } else {
    console.warn("Tauri APIs not available! It looks like you opened this in a normal web browser. The Desktop Pet requires the native Tauri window to function properly.");
  }
  
  // ── Drag Listeners ──
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (!pressMoved && Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 4) {
      pressMoved = true;
    }
    character.x = Math.min(Math.max(e.clientX - grabDX, 0), window.innerWidth - CHAR_WIDTH);
    character.y = Math.min(Math.max(e.clientY - grabDY, 0), visibleBottom() - CHAR_HEIGHT);

    const now = performance.now();
    dragHistory.push({ x: e.clientX, y: e.clientY, t: now });
    while (dragHistory.length > 2 && now - dragHistory[0].t > DRAG_HISTORY_MS) {
      dragHistory.shift();
    }
  });

  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    if (pressMoved && dragHistory.length >= 2) {
      const first = dragHistory[0];
      const last = dragHistory[dragHistory.length - 1];
      const spanMs = last.t - first.t;
      if (spanMs > 20) {
        const scale = 1000 / spanMs;
        character.vx = Math.min(Math.max((last.x - first.x) * scale, -700), 700);
        character.vy = Math.min(Math.max((last.y - first.y) * scale, -700), 700);
      }
    }
    if (!pressMoved) {
      invoke('show_context_menu').catch(console.error);
    }
  });

  window.addEventListener('pointercancel', () => {
    dragging = false;
  });

  // ── Bubble Listeners ──
  bubbleEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    bubbleDragging = true;
    bubblePressMoved = false;
    positionCloseZone();
    closeZoneEl.classList.add('visible');
    setCloseZoneArmed(false);
    const rect = bubbleEl.getBoundingClientRect();
    bubbleGrabDX = e.clientX - rect.left;
    bubbleGrabDY = e.clientY - rect.top;
    bubbleDragStartX = e.clientX;
    bubbleDragStartY = e.clientY;
    try {
      bubbleEl.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture unavailable; drag still works while inside the window
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!bubbleDragging) return;
    if (!bubblePressMoved && Math.hypot(e.clientX - bubbleDragStartX, e.clientY - bubbleDragStartY) > 4) {
      bubblePressMoved = true;
      bubbleEl.classList.add('dragging');
    }
    const left = Math.min(Math.max(e.clientX - bubbleGrabDX, 0), window.innerWidth - BUBBLE_SIZE);
    const top = Math.min(Math.max(e.clientY - bubbleGrabDY, 0), visibleBottom() - BUBBLE_SIZE);
    bubbleEl.style.left = `${left}px`;
    bubbleEl.style.top = `${top}px`;
    setCloseZoneArmed(overCloseZone(bubbleEl));
    syncBubbleRect();
  });

  window.addEventListener('pointerup', () => {
    if (!bubbleDragging) return;
    bubbleDragging = false;
    bubbleEl.classList.remove('dragging');
    if (bubblePressMoved && overCloseZone(bubbleEl)) {
      closeZoneEl.classList.remove('visible');
      setCloseZoneArmed(false);
      invoke('close_app').catch(console.error);
      return;
    }
    closeZoneEl.classList.remove('visible');
    setCloseZoneArmed(false);
    syncBubbleRect(true);
    if (!bubblePressMoved) {
      openChat();
    }
  });

  window.addEventListener('pointercancel', () => {
    bubbleDragging = false;
    closeZoneEl.classList.remove('visible');
    setCloseZoneArmed(false);
  });

  // ── Chat Listeners ──
  chatHeader.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    chatDragging = true;
    chatPressMoved = false;
    chatClosePress = e.target === chatCloseBtn;
    chatRespawnPress = e.target === chatRespawnBtn;
    const rect = chatEl.getBoundingClientRect();
    chatGrabDX = e.clientX - rect.left;
    chatGrabDY = e.clientY - rect.top;
    chatDragStartX = e.clientX;
    chatDragStartY = e.clientY;
    try {
      chatHeader.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture unavailable; drag still works while inside the window
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!chatDragging) return;
    if (!chatPressMoved && Math.hypot(e.clientX - chatDragStartX, e.clientY - chatDragStartY) > 4) {
      chatPressMoved = true;
      chatEl.classList.add('dragging');
    }
    const left = Math.min(Math.max(e.clientX - chatGrabDX, 0), window.innerWidth - chatW);
    const top = Math.min(Math.max(e.clientY - chatGrabDY, 0), visibleBottom() - chatH);
    chatEl.style.left = `${left}px`;
    chatEl.style.top = `${top}px`;
    syncChatRect();
  });

  window.addEventListener('pointerup', () => {
    if (!chatDragging) return;
    chatDragging = false;
    chatEl.classList.remove('dragging');
    syncChatRect(true);
    if (!chatPressMoved && chatClosePress) {
      chatClosePress = false;
      closeChat();
    } else if (!chatPressMoved && chatRespawnPress) {
      chatRespawnPress = false;
      respawnPet();
    }
  });

  window.addEventListener('pointercancel', () => {
    chatDragging = false;
    chatClosePress = false;
    chatRespawnPress = false;
  });

  // ── Chat Resize ──
  window.addEventListener('pointermove', (e) => {
    if (!chatResizing) return;
    const dx = e.clientX - chatResizeStartX;
    const dy = e.clientY - chatResizeStartY;
    const west = chatResizeCorner.includes('w');
    const north = chatResizeCorner.includes('n');

    let w = chatStartW + (west ? -dx : dx);
    let h = chatStartH + (north ? -dy : dy);

    if (west) {
      w = Math.min(Math.max(w, MIN_CHAT_W), chatStartRight);
    } else {
      w = Math.min(Math.max(w, MIN_CHAT_W), window.innerWidth - chatStartLeft);
    }
    if (north) {
      h = Math.min(Math.max(h, MIN_CHAT_H), chatStartBottom);
    } else {
      h = Math.min(Math.max(h, MIN_CHAT_H), visibleBottom() - chatStartTop);
    }

    chatW = w;
    chatH = h;
    chatEl.style.left = `${west ? chatStartRight - w : chatStartLeft}px`;
    chatEl.style.top = `${north ? chatStartBottom - h : chatStartTop}px`;
    chatEl.style.width = `${w}px`;
    chatEl.style.height = `${h}px`;
    syncChatRect();
  });

  window.addEventListener('pointerup', () => {
    if (!chatResizing) return;
    chatResizing = false;
    syncChatRect(true);
  });

  window.addEventListener('pointercancel', () => {
    chatResizing = false;
  });

  chatSend.addEventListener('click', () => {
    void sendMessage();
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void sendMessage();
    }
  });

  // ── Render Loop ──
  const gameTicker = new Ticker();
  let forceRender = true;
  let lastRenderedFrame = -1;

  gameTicker.add((ticker) => {
    if (chatMode) {
      const now = performance.now();
      if (now - lastChatSyncTime >= SYNC_INTERVAL_MS) {
        lastChatSyncTime = now;
        syncChatRect();
      }
      return;
    }
    if (bubbleMode) {
      const now = performance.now();
      if (now - lastBubbleSyncTime >= SYNC_INTERVAL_MS) {
        lastBubbleSyncTime = now;
        positionCloseZone();
        syncBubbleRect();
      }
      return;
    }
    if (!petVisible) return;
    
    const dt = ticker.deltaMS / 1000;

    const prevState = character.state;
    const prevX = character.x;
    const prevY = character.y;
    const prevFacing = character.facing;
    
    if (dragging) {
      character.state = 'fall';
      character.vy = 0;
      character.vx = 0;
      character.landTimer = 0;
    } else {
      updatePhysics(character, dt, platforms, window.innerHeight);
    }
    character.x = Math.min(Math.max(character.x, 0), window.innerWidth - CHAR_WIDTH);
    
    setStateAnimation(character.state);
    if (!chibiSprite.playing) {
      chibiSprite.play();
    }
    
    charContainer.x = character.x;
    charContainer.y = character.y;

    vis.x = chibiSprite.width / 2;
    vis.y = CHAR_HEIGHT;
    vis.scale.x = character.facing;

    if (character.state === 'land') {
      const t = character.landTimer / 150;
      vis.scale.y = 1 - 0.15 * t;
    } else {
      vis.scale.y = 1;
    }

    const stateChanged = character.state !== prevState;
    const movedEnough = Math.abs(character.x - prevX) > 0.5 || Math.abs(character.y - prevY) > 0.5;

    // ── Sync Strategy ──
    if ('__TAURI_INTERNALS__' in window) {
      const now = performance.now();
      const periodicSyncDue = movedEnough && (now - lastSyncTime >= SYNC_INTERVAL_MS);

      if (stateChanged || periodicSyncDue) {
        lastSyncTime = now;
        syncCharacterRect(character.x, character.y).catch(() => {});
      }
    }

    // ── Throttled Render ──
    const needsRender =
      forceRender ||
      stateChanged ||
      movedEnough ||
      character.facing !== prevFacing ||
      character.state === 'land' ||
      chibiSprite.currentFrame !== lastRenderedFrame;

    if (needsRender) {
      forceRender = false;
      lastRenderedFrame = chibiSprite.currentFrame;
      app.render();
    }
  });

  gameTicker.start();
}

function applyClip(sprite: AnimatedSprite, state: CharacterState['state']): void {
  const clip = STATE_CLIPS[state];
  sprite.textures = clips[state];
  sprite.animationSpeed = clip.fps / 60;
  sprite.loop = clip.loop;
  sprite.scale.set(CHAR_SCALE * clipScale(state));
}

function setStateAnimation(state: CharacterState['state']): void {
  if (!clips || !chibiSprite || state === lastAnimatedState) return;
  lastAnimatedState = state;
  applyClip(chibiSprite, state);
  chibiSprite.gotoAndPlay(0);
}

init().catch(console.error);
