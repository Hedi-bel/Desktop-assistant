# Desktop Pet — Project Report

> Comprehensive technical documentation generated from a full inspection of the project source.
> **Scope:** everything under the workspace root tracked + untracked working files (as of this report).
> **Date:** 2026-09-14 · **Platform reviewed:** Windows (primary target)

---

## 1. Project Overview

### Project name
**Desktop Pet** (internal crate name: `playing_with_tauri` / `playing_with_tauri_lib`; packaged product name `desktop-pet`). The chat assistant persona is named **"Frieren-Assistant"**.

### Purpose
A window-aware chibi mascot that lives on the user's desktop. It walks on top of real windows, can be grabbed and thrown, collapses into a circular bubble, and opens a Messenger-style LLM chat when clicked. It is an "overlay pet" — a transparent, click-through, always-on-top window that becomes interactive only when the cursor is over the pet.

### Problem being solved
Boring, static desktop backgrounds. The project turns the desktop itself into a game-like, animated space populated by a responsive character, while staying out of the user's way: the pet never blocks interaction because the hosting window is transparent and click-through by default.

### Main objectives
- Give the pet believable "life": walking, falling, landing with squash, sleeping, and reacting to the user.
- Let the pet use real desktop geometry as its physics world (window top edges = platforms, taskbar = floor).
- Provide non-intrusive interaction: drag/throw, a minimize bubble, and a conversation UI.
- Do it with a small, transparent, always-on-top Tauri window that only captures mouse when needed.

### Target users
Casual/single-user desktop personalization (the app is a personal project on a private repo). Windows users primarily; the code has explicit non-Windows stubs but no working implementation.

---

## 2. Features & Functionalities

### Implemented features

| Feature | Description | How the user interacts |
| --- | --- | --- |
| **Walks on the desktop** | The pet autonomously walks along the top edges of real windows and the taskbar, with idle → walk cycles. | None — ambient behavior. |
| **Drag & throw** | Grab the pet and flick it; throw velocity is measured from recent drag speed (120 ms history), clamped to ±700 px/s; on landing it carries horizontal momentum into a run. | Left-click and hold, move, release. |
| **Love animation** | A 5-frame animation plays when right-clicking the pet while it is grounded. | Right-click the character (not falling, not already animating). |
| **Sleep** | After ~20 s without interaction the pet lies down and sleeps; picking it up wakes it and resets the interaction clock. | Leave it alone, then grab it. |
| **Minimize to bubble** | The pet collapses into a 56 px circular bubble (renders `cute_icon.jpg`). | Left-click the pet without dragging → context menu → *— Minimize*. |
| **Close zone** | While dragging the bubble, a red ✕ circle (56 px) appears near the bottom-center. Dropping the bubble on it quits the app. | Drag the bubble over the red circle and release. |
| **Chat window** | Messenger-style chat (`320×400` default), LLM-powered (Gemini OpenAI-compatible endpoint), with a typing indicator and a strict persona system prompt. | Click the bubble (no drag) → type → Enter or ➤. |
| **Draggable chat** | Drag the window by its header; constrained to the visible desktop area. | Click-hold header, move. |
| **Resizable chat** | Resize from any of the four corners (±), clamped to a `240×320` minimum and screen bounds. | Drag any corner handle. |
| **Respawn** | Brings the pet back as a full character; it falls from the top of the screen. | Click the respawn icon (↻) in the chat header. |
| **System tray** | Tray icon with *Hide Pet* / *Quit*; hiding shows the pet again via the same toggle. | Tray icon → menu. |
| **Click-through management** | The window ignores cursor events except when the cursor is inside a synced rectangle (pet / bubble / chat). | Transparent to the user. |

### Important workflow: pet lifecycle
1. **Startup** — the Rust backend sizes the window to the primary monitor, positions it at (0,0), and sets `ignore_cursor_events(true)` (click-through). The TS layer polls the cached desktop snapshot and seeds platforms.
2. **Ambient** — the pet starts falling from mid-screen, lands on a platform, and enters idle/walk cycles. After 20 s of non-interaction it sleeps.
3. **Interaction** — when the cursor enters the synced rect, the backend re-enables mouse events; left-click drag throws, right-click plays the love animation, left-click without drag opens the context menu.
4. **Bubble** — minimize collapses to the bubble; single click on the bubble opens chat; click ✕ in chat returns to bubble.
5. **Exit** — drop the bubble on the red close-zone (or Quit in the tray) → `app.exit(0)`.

### Workflow: sending a chat message
1. User types and presses Enter (or clicks ➤).
2. `sendMessage()` appends the user bubble, pushes to `chatHistory`, caps to the last 12 messages, disables the send button, shows the typing indicator.
3. `invoke('chat_message', { messages })` → Rust resolves the API key → builds payload (system prompt + last 12 messages) → POSTs to `{base}/chat/completions` with `temperature: 0.8`.
4. Reply is trimmed, appended, history capped again; errors are shown inline as an assistant bubble.

### Not implemented / partially implemented
- **Full desktop awareness** — only window *top edges* and the taskbar become platforms; window sides/bottoms are ignored; the environment is effectively single-monitor (see Known Issues).
- **Animation set** — `idle`, `walk`, `fall`, `land`, `sleep`, `love` are wired. Planned-but-not-built (from earlier design work): edge-peek, close-zone "bye", cursor-gaze, per-emotion chat reactions. The *hang/dangle* animation was added and then removed.
- **Anything beyond Windows** — `platform.rs` contains macOS/Linux stubs returning empty snapshots.

---

## 3. Technical Architecture

### Overall architecture
Three-layer desktop app:

```
┌──────────────────────────────────────────────────────────────┐
│  TS frontend (PixiJS 8, TypeScript, Vite)  ── renders all UI │
│   Pixi canvas (pet)  •  DOM (bubble, close-zone, chat)       │
└──────────┬──────────────────────────────────┬────────────────┘
           │ invoke() / event emit            │ events (listen)
           ▼                                  ▼
┌──────────────────────────────────────────────────────────────┐
│  Rust backend (Tauri 2)  ── state, polling, native features  │
│   • desktop snapshot poller (250 ms)                         │
│   • cursor polling thread (~60 Hz) → click-through toggle    │
│   • system tray + context menus                              │
│   • Gemini LLM proxy (chat_message)                          │
└──────────────────────────────────────────────────────────────┘
           │
           ▼  Win32 API (windows crate)
      EnumWindows / GetWindowRect / FindWindowW("Shell_TrayWnd") / GetCursorPos
```

The app is **one transparent full-screen overlay window** (`label: "main"`) covering the primary monitor. All modes — pet world, bubble, close-zone, chat — live inside that single window and are swapped by visibility toggling.

### Frontend (TS/Vite/PixiJS)
- `src/main.ts` (≈805 lines) — application controller: Pixi setup, character container + sprite, drag/throw, bubble, close-zone, chat (build, drag, resize), respawn, render loop, all Tauri event subscriptions.
- `src/physics.ts` — character state machine and simulation (gravity, walking, landing, sleep clock).
- `src/sprites.ts` — sprite-sheet definitions (pixel rects), clip metadata (frames/fps/loop), scale normalization, clip loading.
- `src/chat.ts` — chat message model, history cap, reply trim.
- `src/types.ts` — data models + `buildPlatforms()` (window rects → sorted platforms, DPR/screen-offset aware).
- `src/styles.css` — all DOM UI styling.

### Tauri/native layer (Rust)
- `src-tauri/src/lib.rs` — window sizing/positioning, `ignore_cursor_events` toggling, managed shared state (`SharedRect`, `SharedSnapshot`), four commands (`update_character_rect`, `get_desktop_snapshot`, `show_context_menu`, `chat_message`, `close_app`), two background threads, tray icon + menus, `app.on_menu_event` for the popup context menu.
- `src-tauri/src/platform.rs` — Win32 window/taskbar enumeration, excluded-own-window filtering, macOS/Linux stubs.
- `src-tauri/src/main.rs` — entry point; suppresses the console window in release builds.
- `src-tauri/tauri.conf.json` — window config, bundle icons, build steps, CSP.
- `src-tauri/capabilities/default.json` — permissions for the `main` window.

### Communication between components
| Mechanism | Direction | Purpose |
| --- | --- | --- |
| `invoke()` (`@tauri-apps/api/core`) | TS → Rust | `update_character_rect`, `get_desktop_snapshot`, `show_context_menu`, `chat_message`, `close_app` |
| `listen()` (`@tauri-apps/api/event`) | Rust → TS | `desktop-snapshot`, `pet-visibility`, `pet-bubble-toggle` |
| Rust shared state (`Arc<Mutex<...>>`) | poller → commands | Cached snapshot & character rect |

### Data flow (desktop → physics)
1. `platform.rs::enumerate_windows` collects visible top-level windows + taskbar → `DesktopSnapshot`.
2. Poller caches it and emits `desktop-snapshot` only when changed (cached-first ordering guarantees the cache is never older than an emitted event).
3. `types.ts::buildPlatforms` converts physical screen pixels → CSS pixels (`/dpr`, minus `window.screenX/Y`), filters small/windowless entries, sorts by Y.
4. `main.ts` stores platforms, calls `refreshPlatformReference` to re-attach the pet if its platform moved; the render loop feeds platforms + char + screen height into `updatePhysics`.

### External services/APIs
- **Google Gemini** (OpenAI-compatible) — the only network dependency. Uses `https://generativelanguage.googleapis.com/v1beta/openai` `/chat/completions`, model `gemini-3.6-flash`, authenticated via a bearer token **and** the `x-goog-api-key` header simultaneously.
- **Windows Win32 API** (via the `windows` crate) — local only.

---

## 4. Technology Stack

| Layer | Technology | Version (as declared) | Why |
| --- | --- | --- | --- |
| Desktop shell | Tauri 2 (`tauri`, `tauri-build`) | `2` | Transparent, frameless, click-through window; tiny footprint vs Electron; Rust backend |
| Native tray/menu | Tauri tray-icon feature | `2` | System tray + popup menus |
| UI / rendering | PixiJS 8 (WebGL) | `^8` | Sprite-sheet animation + full-window transparent canvas |
| Frontend language | TypeScript | `~6.0.3` | Strict typing across the animation/physics state machine |
| Frontend build | Vite | `^8.0.16` | Dev server (fixed port 1420) + bundling for Tauri |
| Backend language | Rust | edition 2021 | Hot-path polling threads, Win32 FFI, network calls |
| Native FFI | `windows` crate | `0.58` | Win32 window enumeration, taskbar, cursor position |
| HTTP | `reqwest` | `0.12` | Gemini chat calls (JSON) |
| Serialization | `serde` / `serde_json` | `1` | Command + snapshot types, chat payload |
| Tauri APIs (JS) | `@tauri-apps/api` | `^2` | invoke/listen |
| Plugin (unused) | `@tauri-apps/plugin-opener` | `^2` | Initialized but not used (template leftover) |
| Package manager | npm | — | `package-lock.json` present |

### Runtime
- Windows desktop (primary). Transparent overlay window: `resizable=false`, `decorations=false`, `transparent=true`, `alwaysOnTop=true`, `skipTaskbar=true`. At startup the backend opens the window with the primary monitor's physical size at its origin.
- `withGlobalTauri: true` injects Tauri internals into the window.
- Frontend served from `http://localhost:1420` in dev, bundled `../dist` in production.

### Database / storage
**None.** No filesystem persistence, no localStorage, no SQLite. Everything (platforms, chat history, bubble position, window prefs) lives in memory and is reset on restart. The only local file is the git-ignored `.chat.env` API-key file (loaded at runtime, not committed).

### APIs and services
- Local: `update_character_rect`, `get_desktop_snapshot`, `show_context_menu`, `chat_message`, `close_app` (Tauri commands).
- Remote: Gemini `/chat/completions` (system prompt + ≤12 message history, `temperature: 0.8`).

---

## 5. Project Structure

```
Desktop/  (workspace root, git repo)
├─ README.md                     ← Project README (root, canonical)
├─ PROJECT_REPORT.md             ← This report
└─ Playing_With_Tauri/           ← Tauri frontend crate
   ├─ README.md                  ← Redirect to ../README.md
   ├─ index.html                 ← Single-page entry (#app)
   ├─ package.json               ← TS scripts + deps
   ├─ tsconfig.json              ← strict TS (ES2020, bundler resolution)
   ├─ vite.config.ts             ← Vite for Tauri (port 1420, HMR 1421)
   ├─ package-lock.json
   ├─ .gitignore                 ← node_modules, dist, env, editors
   ├─ .vscode/extensions.json    ← Editor extension suggestions
   ├─ src/
   │  ├─ main.ts                 ← ALL UI logic (pet, bubble, chat, close-zone, loop)
   │  ├─ physics.ts              ← Sim: states, gravity, fall/land, sleep clock
   │  ├─ sprites.ts              ← Sheet pixel-rects, clip defs, scale, loader
   │  ├─ chat.ts                 ← ChatMsg, history cap, trimReply
   │  ├─ types.ts                ← WinRect/Platform/DesktopSnapshot + buildPlatforms
   │  ├─ vite-env.d.ts           ← Vite client types
   │  ├─ styles.css              ← All DOM styling
   │  └─ assets/
   │     ├─ idle.png  walk.png  fall.png  land.png   ← base animation sheets
   │     ├─ sleeping.png                            ← sleep sheet (4 frames)
   │     ├─ lovable.png                             ← love sheet (5 frames)
   │     ├─ Dangle.png                              ← UNUSED (hang anim removed)
   │     ├─ cute_icon.jpg                          ← pet/avatar/bubble art
   │     └─ respawn_icon.png                       ← chat respawn button
   └─ src-tauri/
      ├─ Cargo.toml             ← Rust crate (+ release profile: lto, strip)
      ├─ Cargo.lock
      ├─ build.rs               ← tauri_build::build()
      ├─ tauri.conf.json        ← window def, bundle, build, CSP
      ├─ capabilities/default.json ← permissions for window "main"
      ├─ .gitignore             ← target/, .chat.env, gen/schemas
      ├─ .chat.env              ← API key (local only, git-ignored)
      ├─ icons/                 ← App/tray icons (png/ico/icns + logo set)
      └─ src/
         ├─ main.rs             ← Entry; hides console in release
         ├─ lib.rs              ← Commands, threads, tray, menus, Gemini proxy
         └─ platform.rs         ← Win32 enumeration; non-Windows stubs
```

### Key file responsibilities in depth

**`src/physics.ts`**
- Constants: `GRAVITY 980`, `WALK_SPEED 60`, `IDLE 500–2500 ms`, `MAX_FALL_SPEED 700`, `AIR_DRAG 2.5`, `SLEEP_AFTER_MS 20000`.
- `PetState = 'idle' | 'walk' | 'fall' | 'land' | 'sleep' | 'love'`.
- `CharacterState` — x/y/vx/vy, state, currentPlatform, targetX, facing, idleTimer, landTimer, paused, dozeTimer, loveTimer, lovePrev.
- Collision helpers: `canLandOn`, `isOnPlatform`, `findLandingPlatform`, `randomTargetOnPlatform`, `worldFloor`, `respawnCharacter`, `platformStillExists`, `refreshPlatformReference`.
- `updatePhysics` — pause guard; doze clock decrement; per-state logic: idle (platform validation, sleep check, walk pick), sleep (platform validation), walk (move toward target, platform re-check), fall (gravity+air drag, landing → momentum `walk` glide or `land`, off-floor respawn), land (countdown → idle), love (countdown → restore `lovePrev`).

**`src/sprites.ts`**
- `FRAME_RECTS` — pixel rectangles (`rows`, `cols`) for each state's sheet, e.g. love uses `lovable.png` rows `[33,685]`, 5 columns.
- `STATE_CLIPS` — per-state `{ frames, fps, loop }` (love: 5 frames @ 8 fps, one-shot).
- `BASE_STATES` (idle/walk/fall/land) → `REF_FRAME_H` (average art height) and `CHAR_SCALE` (fit 48×64 ×1.3). `clipScale(state)` normalizes non-base sheets to the same rendered height.
- `loadCharacterClips()` — loads each sheet via Pixi `Assets`, forces linear scaling + mipmaps, slices per-rect `Texture`s.

**`src/main.ts`**
- Startup: `app.init` (transparent, resize-to-window) → builds bubble/close-zone/chat DOM → character → `loadCharacterClips` → event listeners → global drag/resize handlers → render loop.
- Render loop branches by mode: `chatMode` (periodic chat rect sync only) → `bubbleMode` (sync + close-zone position) → `petVisible` (physics + animation + rect sync).
- Rect sync: CSS + `window.screenX/Y` → physical px (`× dpr`), 10 Hz drift correction, fire-and-forget invoke.
- `setStateAnimation`/`applyClip` — swap clip on state change; also applies `CHAR_SCALE × clipScale`.
- Interaction state flags: pet drag (`dragging`, `dragHistory`, 120 ms throw sampler), bubble drag, chat drag, chat resize (four corners).

**`src-tauri/src/lib.rs`**
- Tauri commands and two spawned threads (snapshot poller 250 ms, cursor poller ~60 Hz toggling `set_ignore_cursor_events`).
- Menu/tray setup; `on_menu_event` maps `minimize` → `pet-bubble-toggle`, `close` → exit (close arm is dead).
- Gemini proxy: `resolve_api_key` (env `PETFISH_API_KEY` → `CARGO_MANIFEST_DIR/.chat.env`), overrides `PETFISH_API_BASE` / `PETFISH_MODEL`; builds messages (system + last 12), calls endpoint, trims and returns `choices[0].message.content`.

**`src-tauri/src/platform.rs`**
- Win32 `EnumWindows` callback: skips own windows, invisible, minimized, tool-window or untitled windows; captures title + rect. Taskbar captured via `FindWindowW("Shell_TrayWnd")`. Non-Windows → empty snapshot.

---

## 6. UI/UX

### Screens / windows
Everything is inside the single overlay window. Visually there are four "screens":

| Screen | Element | Tech |
| --- | --- | --- |
| Pet world | The walking character | PixiJS canvas |
| Bubble | 56 px circular avatar | DOM div |
| Close-zone | 56 px red ✕ circle | DOM div |
| Chat | Messenger-style panel | DOM div |

### Components
- **Character**: `AnimatedSprite` inside a `Container`; anchor bottom-center; per-state clip; `vis.scale.x` flips for facing; `land` applies a temporary `scale.y` squash (0.85).
- **Bubble**: rounded `div` with `object-fit: cover` image, white ring + shadow, `cursor: grab`.
- **Close-zone**: red circle, `pointer-events: none`, `.armed` state scales up + brightens; positioned at `visibleBottom() - 56 - 12`.
- **Chat**: header (avatar + title + respawn + ✕), scrollable body (rows with tails, typing row), input bar (rounded field + circular ➤ send). Corner handles `se/sw/ne/nw` with grip glyph on `se`.

### Navigation / interaction map
```
 pet (left-click, no drag)  ─────────────────────────────►  context menu  ──►  — Minimize ──►  bubble
 pet (right-click, grounded) ────────────────────────────►  love animation
 pet (left-drag) ────────────────────────────────────────►  throw
 bubble (click) ─────────────────────────────────────────►  chat window
 chat (✕) ───────────────────────────────────────────────►  bubble
 chat (↻ respawn) ───────────────────────────────────────►  pet falls from top
 bubble (drag onto red ✕) ───────────────────────────────►  app exits
 tray ▾ → Hide Pet / Quit ───────────────────────────────►  hide/show pet  •  exit
```

### Visual design
- Messenger-style chat: blue (`#0084ff`) user bubbles right, gray (`#f0f0f0`) pet bubbles left, 4 px tails, rounded field + circular send; Segoe UI / system-ui.
- Pet: pixel-art sprite sheets (idle/walk/fall/land/sleep/love).
- Bubble & close-zone: clean white/red circles with soft shadows.
- Everything transparent in the window; no window chrome.

### Responsive / adaptive behavior
- Chat is user-resizable (240×320 min) and constrained to the visible desktop.
- Bubble/pet/chat are clamped to the window (primary monitor) and to `visibleBottom()` (lowest platform).
- DPR-aware coordinate conversion throughout (`window.devicePixelRatio`), multi-monitor offset handled for the primary screen (`window.screenX/Y`).

---

## 7. Detailed Feature Analysis

### 7.1 Pet movement & physics
- **Purpose**: ambient believable walking life on real desktop geometry.
- **Inputs**: `platforms` (from desktop snapshot), `dt`, character state.
- **Processing**: gravity (`980 px/s²`), terminal velocity (`700`), air drag (`2.5/s`), walk speed `60 px/s`, platform landing detection (horizontal center within platform + feet crossing y), throw-momentum carry-over (`0.6×` or `120 px` minimum glide into `walk`).
- **Outputs**: character x/y/state per tick; renders as animated clip.
- **Dependencies**: `physics.ts`, `types.ts::buildPlatforms`, `platform.rs`, Pixi ticker.
- **Files**: `src/physics.ts`, `src/main.ts:718-787`, `src/types.ts`, `src-tauri/src/platform.rs`.

### 7.2 Drag & throw
- **Purpose**: physical toy feel — flick the pet.
- **Inputs**: pointerdown on `charContainer` (left button), drag history (≤120 ms window).
- **Processing**: while dragging, pet follows pointer (clamped); `character.state='fall'` each tick; on release, velocity = displacement/span × 1000 clamped to ±700 for vx/vy.
- **Outputs**: thrown pet (fall → land/walk per physics).
- **Dependencies**: `dragHistory`, pointer capture on canvas.
- **Files**: `src/main.ts:427-454, 518-549, 744-748`.

### 7.3 Love animation (right-click)
- **Purpose**: social expression.
- **Inputs**: right-click (`e.button === 2`) on the character.
- **Processing**: guard — not dragging, not `'fall'`, not already `'love'` → save `lovePrev`, set `loveTimer` (clips-derived ~625 ms), state `'love'`. On timer end restore `lovePrev` (with an `idleTimer` reset if restoring idle).
- **Outputs**: one-shot 5-frame clip at 8 fps; native browser context menu suppressed (`contextmenu` preventDefault on canvas).
- **Dependencies**: `STATE_CLIPS.love`, `lovable.png`, `loveTimer`/`lovePrev`, `applyClip` scale normalization.
- **Files**: `src/main.ts:336,446-453,790-803`, `src/physics.ts` (`love` case), `src/sprites.ts`.

### 7.4 Sleep
- **Purpose**: ambient realism / idle behavior.
- **Inputs**: wall-clock time while un-interacted (doze clock drains on every grounded tick; NOT only during idle — fixed so it actually triggers).
- **Processing**: on draining to ≤0 while in `idle`, → `'sleep'` (validates platform). `wakePet()` on any left-click resets the clock; picking up a sleeping pet wakes to `idle`.
- **Outputs**: 4-frame sleep loop; resumes walking/idle after wake.
- **Dependencies**: `SLEEP_AFTER_MS` (shared const), `SLEEP` clip.
- **Files**: `src/physics.ts:190-242`, `src/main.ts:190-196`.

### 7.5 Minimize to bubble
- **Purpose**: collapse out of the way without quitting.
- **Inputs**: context-menu item *— Minimize* (left-click no-drag on the pet → `show_context_menu` → `minimize` menu event).
- **Processing**: Rust emits `pet-bubble-toggle` → TS hides pet, positions bubble (right edge, ~40% height), shows it, syncs rect.
- **Outputs**: bubble mode; drag/click handlers switch context.
- **Dependencies**: `show_context_menu`, `app.on_menu_event`, `pet-bubble-toggle`.
- **Files**: `src-tauri/src/lib.rs:45-60,185-195`, `src/main.ts:501-512`.

### 7.6 Close zone
- **Purpose**: intuitive "drag to trash" exit.
- **Inputs**: bubble `pointerdown` → shows close-zone; bubble drag `pointermove` → arm when bubble center overlaps zone rect (checked BEFORE hiding — the earlier bug fix).
- **Processing**: drop (moved) while armed → `close_app` → `app.exit(0)`. Zone only appears for bubble drags, not chat.
- **Outputs**: application termination.
- **Dependencies**: `overCloseZone`, `positionCloseZone` (bottom-center above lowest platform), close-zone CSS `.armed`.
- **Files**: `src/main.ts:125-144,556-611,346-350`, `src/styles.css:308-337`, `src-tauri/src/lib.rs:40-43`.

### 7.7 Chat
- **Purpose**: LLM conversation with the pet persona.
- **Inputs**: user text, Enter/➤; history (≤12 msgs); API key + base + model.
- **Processing**: TS trims + appends; Rust builds the request (system prompt + last 12), sends bearer + `x-goog-api-key`, temperature 0.8, reads `choices[0].message.content`.
- **Outputs**: assistant bubble; timer disables the send button; typer indicator while pending; errors surfaced in chat.
- **Dependencies**: `chat_message`, Gemini API (network), `.chat.env`/env.
- **Files**: `src/main.ts:279-303,706-715`, `src-tauri/src/lib.rs:62-160`, `src/chat.ts`.

### 7.8 Click-through management
- **Purpose**: the full-screen window must not block the desktop.
- **Inputs**: character/bubble/chat rect synced via `update_character_rect`; cursor position polled at 60 Hz.
- **Processing**: Rust checks `GetCursorPos` inside the rect → flips `set_ignore_cursor_events` only on change.
- **Outputs**: mouse only captured over interactive elements.
- **Dependencies**: `SharedRect`, cursor thread, `core:window:allow-set-ignore-cursor-events` permission.
- **Files**: `src-tauri/src/lib.rs:234-265`, `src/main.ts:305-325`.

---

## 8. Installation & Development

### Prerequisites
- Windows (this is the only implemented platform).
- Node.js (18+ per README).
- Rust toolchain (stable, edition 2021). MSVC toolchain recommended.
- A Google Gemini API key for chat (optional — pet works without it; chat shows an error otherwise).

### Installation
```bash
git clone https://github.com/Hedi-bel/Desktop-assistant-.git   # private repo
cd "Playing_With_Tauri"
npm install
```

### Environment variables / secrets
| Variable | Default | Purpose |
| --- | --- | --- |
| `PETFISH_API_KEY` | — (required for chat) | Gemini API key; fallback to `src-tauri/.chat.env` |
| `PETFISH_API_BASE` | `https://generativelanguage.googleapis.com/v1beta/openai` | Endpoint base |
| `PETFISH_MODEL` | `gemini-3.6-flash` | Chat model |
| `TAURI_DEV_HOST` | — | Vite dev host for Tauri (see `vite.config.ts`) |

`src-tauri/.chat.env` is git-ignored (`.gitignore:6`) and not tracked.

### Development
```bash
npm run tauri dev     # Vite (port 1420) + Rust dev build, hot reload
npm run dev           # Vite only (pet won't work fully without Tauri)
```

### Build & packaging
```bash
npm run build         # tsc type-check + vite build → dist/
npm run tauri build   # release bundle (NSIS/MSI etc., targets "all"; icons set)
```
Release profile (`Cargo.toml`): `codegen-units=1`, `lto=true`, `opt-level=3`, `panic="abort"`, `strip=true`.

---

## 9. Security

### Tauri capabilities (`src-tauri/capabilities/default.json`)
Limited to the `main` window:
- `core:default`, `core:event:default`, `core:window:default`
- `core:window:allow-set-ignore-cursor-events`, `-set-position`, `-set-size`, `-show`, `-hide`, `-is-visible`
- `opener:default`
No filesystem, shell, or HTTP-scope permissions. The frontend can only move/resize/show its own window.

### API security
- The Gemini key is sent only over HTTPS (reqwest), as both `Authorization: Bearer` and `x-goog-api-key` (Google's OpenAI-compatible endpoint accepts this pattern).
- The key never enters the frontend — `resolve_api_key` runs entirely in Rust and only the reply text crosses the IPC boundary.
- No secrets in the repo (verified via `git ls-files`); `.chat.env` is ignored and excluded from the bundle.

### Known weaknesses
- API key storage is plaintext (`src-tauri/.chat.env` or an env var); no OS keychain. Anyone with file access to the dev directory can read it.
- `"csp": null` — the window has no Content-Security-Policy.
- `withGlobalTauri: true` exposes Tauri internals to any script in the window.
- Chat text is rendered via `textContent` (XSS-safe) but the system prompt is fixed server-side in Rust; the model sees whatever history the user typed (normal chat-app behavior).
- There is no input validation on `chat_message` (message count/size) — the payload is capped to 12 messages but text length is unlimited.

---

## 10. Performance & Reliability

### Resource usage
- One full-monitor, transparent, always-on-top WebGL canvas rendered continuously by PixiJS (roughly 60 fps) even when the pet is idle or in bubble/chat mode — the dominant cost.
- Two Rust polling threads: desktop snapshot every 250 ms (walks all top-level windows via `EnumWindows` + `GetWindowTextW`), cursor check at ~60 Hz.
- ~7 sprite sheets ≈ 8 MB PNG decoded into GPU textures (per Vite build output); negligible memory otherwise.
- Release build is optimized (LTO, strip) per `Cargo.toml`.

### Error handling
- IPC invoke calls are fire-and-forget with `.catch(...)` (silent drops acceptable for rect sync).
- Chat failures (network, HTTP status, JSON parse, missing key) → surfaced as an inline assistant bubble with the exact cause (e.g. *"Chat brain is unplugged — set PETFISH_API_KEY…"*).
- Rust threads use `eprintln!` diagnostics; shared-mutex access uses `lock().unwrap()` (panics on poisoning) in hot paths, `lock().unwrap_or_else` in the snapshot command.
- Snapshot poller never panics on enum failure (callback swallows errors via `Option`).

### Bottlenecks / optimization opportunities
1. **Unthrottled rendering** during static modes (idle/bubble/chat) — the ticker still renders every frame.
2. **Snapshot enumeration** reads window *titles* every poll (needed for filtering) — acceptable at 250 ms but could reuse cached titles keyed by HWND.
3. No delta-render: the Pixi scene rarely changes while idle yet redraws continuously.
4. Single-threaded lock: `SharedRect` is read on the 60 Hz thread and written from the frontend — fine at this rate, but could use atomics.

---

## 11. Current Project Status

| Feature / area | Status | Notes |
| --- | --- | --- |
| Walking on desktop (windows + taskbar) | ✅ Implemented | Windows-only |
| Drag & throw with momentum | ✅ Implemented | |
| Fall / land (squash) | ✅ Implemented | |
| Sleep after idle (20 s) | ✅ Implemented | Wakes on pickup |
| Love animation (right-click, grounded) | ✅ Implemented | 5-frame one-shot |
| Context menu → Minimize to bubble | ✅ Implemented | |
| Bubble drag + close-zone quit | ✅ Implemented | Bubble-only drag behavior |
| Chat window + LLM | ✅ Implemented | Gemini, last-12 history |
| Chat header drag + 4-corner resize | ✅ Implemented | |
| Chat respawn pet (falls from top) | ✅ Implemented | |
| System tray (hide/show, quit) | ✅ Implemented | |
| Click-through management | ✅ Implemented | Cursor-poll rect logic |
| Multi-monitor support | 🟡 Partial | Single primary monitor assumption; coordinate math has DPR/screenX handling |
| Full-desktop platforms | 🟡 Partial | Only window top edges; title-less windows excluded |
| macOS / Linux | 🔴 Not implemented | `platform.rs` stubs return empty snapshots |
| Persistence (chat history, prefs, positions) | 🔴 Not implemented | In-memory only |
| Chat markdown / rich rendering | 🔴 Not implemented | Plain text |
| Hang/dangle animation | 🔴 Removed | `Dangle.png` still in repo, unused |
| Edge-peek, close-zone "bye", cursor-gaze | 🔵 Planned | From earlier animation design (not in code) |
| Chat emotion reactions | 🔵 Planned | |
| Tests (unit/integration) | 🔴 Not implemented | No test files/scripts |

---

## 12. Known Issues & Technical Debt

### Bugs / correctness
- Startup window uses a hardcoded 1920×1080 default; the setup correctly overrides it to the primary monitor — but if the primary monitor is not the top-left of the virtual desktop, `window.screenX/Y` offsets (assumed 0) skew rect-to-CSS conversion (mitigated only on primary).
- `updatePhysics` clamp uses `window.innerHeight` as screen bound and `visibleBottom()` as floor — consistent with a single full-monitor window, but not with multi-monitor.
- Tracking threads: cursor toggle and snapshot logic are best-effort with no recovery if `app.get_webview_window("main")` returns `None` inside the mouse thread (it clones the window once at start — fine).
- Snapshot emit uses `PartialEq` comparison of full vector each 250 ms; non-deterministic Windows returns (e.g. transient hidden windows) can churn events.

### Dead code / leftovers
- `Dangle.png` (≈1.4 MB) is committed but unused after the hang animation was removed.
- Physics still has a `paused` field + pause-guard; the pause feature was removed — only `respawnPet` sets it (to false). Dead path.
- `lib.rs` `on_menu_event` still handles a `"close"` menu id that no menu creates (dead arm).
- `@tauri-apps/plugin-opener` is a dependency, is initialized, and has a capability — but no code calls it (template leftover).
- `src/main.ts:439` has an indentation inconsistency (`dragHistory = [...]`) from an earlier edit.

### Configuration issues
- `"csp": null` — no content security policy (acceptable for a local app, weak barrier otherwise).
- Bundle targets `"all"` with the icon set present — verified compatible.

### Architectural notes
- `main.ts` is a single ~805-line controller holding ~30 module-level mutable globals for three UI modes; hard to unit test and monitor for state leaks.
- UI position logic is duplicated for pet/bubble/chat (three rect-sync functions).
- No test harness at all currently.

---

## 13. Future Improvements

### Quick wins (low effort, high value)
1. **Throttle rendering** — pause/limit Pixi ticker when in `bubbleMode`/`chatMode` and when idle+static (only render on movement/state change). Biggest battery/CPU win.
2. **Remove dead weight** — delete `Dangle.png`, the `paused` physics guard, the `"close"` menu arm, and the unused `plugin-opener` dependency+capability.
3. **Persist user prefs** — chat history, bubble position, chat size/position via `localStorage` (allowed under `core:default`).
4. **Add unit tests** — pure functions (`buildPlatforms`, physics transitions, `clipScale`) using `vitest`; trivial to add to the existing Vite toolchain.
5. **Zip/compress sprite sheets** — sheets are ~1 MB each (mostly transparent); pack into a single atlas to cut load time.

### Medium
6. **Markdown chat rendering** — render code blocks/links with a sanitizer instead of raw text.
7. **Better idle variety** — more ambient animations (peek over the taskbar edge, look toward the cursor).
8. **Configurable persona/name/model** — surface `PETFISH_MODEL` etc. in a settings panel instead of env-only.

### Major architectural changes
9. **Real multi-monitor support** — either position/clamp per the virtual desktop bounds or place one overlay window per monitor (big change to rect math in `main.ts` and window sizing in `lib.rs`).
10. **Floor-relative pet behaviors** — landing on window *top edges only* is limiting; add side/bottom awareness or a "hiding behind window" auto-behavior.
11. **Local-first LLM option** — the OpenAI-compatible plumbing already supports a custom `PETFISH_API_BASE`; document/prefer a local endpoint (e.g. Ollama) to remove the key entirely.
12. **macOS/Linux implementations** of `platform.rs` (each needs a native enumerator).

---

## 14. Conclusion

**What it is today.** A polished Windows desktop mascot: a pixel-art pet that walks on top of real windows, can be dragged and thrown with believable physics, dozes off, reacts with a love animation, collapses into a bubble, quits by being dragged onto a red ✕, and chats through a Messenger-style window backed by Gemini — all inside one transparent, click-through, always-on-top Tauri window with two small Rust polling threads.

**Strongest aspects.** The core idea is fully working and feels native: platform-aware walking, physics you can *feel* (throw momentum carries into a run), the minimal two-rect-click-through trick, the DPR-correct coordinate plumbing, and a genuinely usable chat with a well-crafted persona prompt. The codebase is small, typed strictly, and cleanly split (`physics.ts`, `sprites.ts`, `main.ts`, Rust modules).

**Limitations.** Single-monitor; Windows-only; zero persistence; no tests; one big frontend file with heavy module-global state; continuous 60 fps rendering even when idle; a few dead leftovers; a plaintext API key; no CSP.

**Recommended next steps.** (1) Throttle the render loop when idle/static, (2) strip dead code/assets and the unused plugin, (3) add focused unit tests for physics and platform building, (4) persist chat history and window preferences, (5) then plan the multi-monitor work if the pet is meant to roam all screens.