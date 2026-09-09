/**
 * Raw window rectangle from the Rust backend.
 */
export interface WinRect {
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A standable horizontal surface — the top edge of a window or taskbar.
 */
export interface Platform {
  /** Identifier (window title or 'taskbar') */
  id: string;
  /** Left edge X coordinate (screen pixels) */
  x: number;
  /** Y coordinate of the surface (top edge of the window) */
  y: number;
  /** Width of the platform */
  width: number;
}

/**
 * Desktop snapshot payload from the Rust backend.
 */
export interface DesktopSnapshot {
  windows: WinRect[];
  taskbar: WinRect | null;
}

/**
 * Convert raw window rects into sorted standable platforms.
 * Each window's top edge becomes a platform.
 * The taskbar's top edge becomes the floor platform.
 */
export function buildPlatforms(snapshot: DesktopSnapshot): Platform[] {
  const platforms: Platform[] = [];

  // Win32 GetWindowRect returns physical screen pixels.
  // The webview renders in logical CSS pixels. 
  // We must divide by devicePixelRatio to convert.
  const dpr = window.devicePixelRatio || 1;
  
  // If the user has multiple monitors, the Tauri window might not be at 0,0.
  // window.screenX/Y give the logical coordinates of the webview on the screen.
  const offsetX = window.screenX || 0;
  const offsetY = window.screenY || 0;

  // Each window's top edge is a platform
  for (const win of snapshot.windows) {
    // Only include windows with reasonable size (at least 50px wide)
    if (win.w >= 50) {
      platforms.push({
        id: `win:${win.title}`,
        x: (win.x / dpr) - offsetX,
        y: (win.y / dpr) - offsetY,       // top edge of the window
        width: win.w / dpr,
      });
    }
  }

  // Taskbar top edge is the floor
  if (snapshot.taskbar) {
    const tb = snapshot.taskbar;
    platforms.push({
      id: 'taskbar',
      x: (tb.x / dpr) - offsetX,
      y: (tb.y / dpr) - offsetY,          // top edge of the taskbar
      width: tb.w / dpr,
    });
  }

  // Sort by Y ascending (topmost platforms first)
  platforms.sort((a, b) => a.y - b.y);

  return platforms;
}
