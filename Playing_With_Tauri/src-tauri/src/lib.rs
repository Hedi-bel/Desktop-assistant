mod platform;

use platform::{enumerate_windows, DesktopSnapshot};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::POINT;

const POLL_INTERVAL_MS: u64 = 250;

type PauseState = Arc<Mutex<bool>>;

#[derive(Default, Clone, Copy, Debug)]
struct CharRect {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}
type SharedRect = Arc<Mutex<Option<CharRect>>>;
type SharedSnapshot = Arc<Mutex<Option<DesktopSnapshot>>>;

#[tauri::command]
fn update_character_rect(x: i32, y: i32, w: i32, h: i32, rect_state: tauri::State<SharedRect>) {
    *rect_state.lock().unwrap() = Some(CharRect { x, y, w, h });
}

#[tauri::command]
fn get_desktop_snapshot(state: tauri::State<SharedSnapshot>) -> Option<DesktopSnapshot> {
    let cache = state.lock().unwrap_or_else(|e| e.into_inner());
    if cache.is_none() {
        eprintln!("[desktop-pet] get_desktop_snapshot: cache not ready yet");
    }
    cache.clone()
}

#[tauri::command]
fn show_context_menu(app: tauri::AppHandle, pause_state: tauri::State<PauseState>) -> Result<(), String> {
    let paused = *pause_state.lock().unwrap();
    let pause_label = if paused { "▶  Resume" } else { "⏸  Pause" };

    let pause_item = MenuItem::with_id(&app, "pause", pause_label, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let close_item = MenuItem::with_id(&app, "close", "✕  Close", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let menu = Menu::with_items(&app, &[&pause_item, &close_item])
        .map_err(|e| e.to_string())?;

    if let Some(main_win) = app.get_webview_window("main") {
        main_win
            .popup_menu(&menu)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pause_state: PauseState = Arc::new(Mutex::new(false));
    let shared_rect: SharedRect = Arc::new(Mutex::new(None));
    let shared_snapshot: SharedSnapshot = Arc::new(Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(pause_state)
        .manage(shared_rect.clone())
        .manage(shared_snapshot.clone())
        .invoke_handler(tauri::generate_handler![show_context_menu, update_character_rect, get_desktop_snapshot])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("no main window");
            
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let size = monitor.size();
                let pos = monitor.position();
                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(pos.x, pos.y)));
                let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(size.width, size.height)));
            }
            
            let _ = window.set_ignore_cursor_events(true);
            
            let app_handle_menu = app.handle().clone();
            let pause_state_clone = app.state::<PauseState>().inner().clone();
            app.on_menu_event(move |_app, event| {
                match event.id().as_ref() {
                    "pause" => {
                        let mut paused = pause_state_clone.lock().unwrap();
                        *paused = !*paused;
                        let _ = app_handle_menu.emit("pet-pause-toggle", ());
                    }
                    "close" => {
                        app_handle_menu.exit(0);
                    }
                    _ => {}
                }
            });

            #[cfg(target_os = "windows")]
            let own_hwnds: Vec<isize> = {
                let mut hwnds = Vec::new();
                if let Ok(h) = window.hwnd() {
                    hwnds.push(h.0 as isize);
                }
                hwnds
            };
            #[cfg(not(target_os = "windows"))]
            let own_hwnds: Vec<isize> = Vec::new();
            
            let app_handle = app.handle().clone();
            let shared_snapshot = app.state::<SharedSnapshot>().inner().clone();
            
            std::thread::spawn(move || {
                eprintln!("[desktop-pet] snapshot poller started");
                loop {
                    let snapshot = enumerate_windows(&own_hwnds);
                    
                    let should_emit = {
                        // Cache the latest snapshot every iteration, BEFORE the change
                        // check and emit, so get_desktop_snapshot() can never return
                        // data older than a desktop-snapshot event already sent to the UI.
                        let mut cache = shared_snapshot.lock().unwrap();
                        let changed = cache.as_ref() != Some(&snapshot);
                        *cache = Some(snapshot.clone());
                        changed
                    };
                    
                    if should_emit {
                        let _ = app_handle.emit("desktop-snapshot", &snapshot);
                    }
                    
                    std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
                }
            });
            
            // --- Mouse Tracking Thread ---
            let main_win_clone = window.clone();
            std::thread::spawn(move || {
                let mut was_over = false;
                loop {
                    let mut is_over = false;
                    
                    #[cfg(target_os = "windows")]
                    {
                        let mut point = POINT::default();
                        unsafe {
                            if GetCursorPos(&mut point).is_ok() {
                                if let Some(rect) = *shared_rect.lock().unwrap() {
                                    if point.x >= rect.x && point.x <= rect.x + rect.w &&
                                       point.y >= rect.y && point.y <= rect.y + rect.h {
                                        is_over = true;
                                    }
                                }
                            }
                        }
                    }
                    // For macOS/Linux we'll just ignore it for now or assume not over
                    
                    if is_over != was_over {
                        was_over = is_over;
                        // Enable mouse events when hovering character, otherwise click-through
                        let _ = main_win_clone.set_ignore_cursor_events(!is_over);
                    }
                    
                    std::thread::sleep(Duration::from_millis(16)); // ~60Hz
                }
            });
            
            let toggle_i = MenuItem::with_id(app, "toggle", "Hide Pet", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_i, &quit_i])?;
            
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Desktop Pet")
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "toggle" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let visible = win.is_visible().unwrap_or(true);
                                if visible {
                                    let _ = win.hide();
                                } else {
                                    let _ = win.show();
                                }
                                let _ = app.emit("pet-visibility", !visible);
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
