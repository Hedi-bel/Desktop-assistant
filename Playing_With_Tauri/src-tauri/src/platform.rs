use serde::Serialize;

/// Rectangle representing a desktop window or the taskbar.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WinRect {
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DesktopSnapshot {
    pub windows: Vec<WinRect>,
    pub taskbar: Option<WinRect>,
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::{DesktopSnapshot, WinRect};
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::sync::{Arc, Mutex};
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
        IsWindowVisible, GWL_EXSTYLE, GWL_STYLE, WINDOW_EX_STYLE, WINDOW_STYLE, WS_EX_TOOLWINDOW,
        WS_MINIMIZE, WS_VISIBLE,
    };

    struct EnumState {
        windows: Vec<WinRect>,
        /// HWNDs to exclude (our own windows — main overlay + hitbox).
        excluded_hwnds: Vec<isize>,
    }

    unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state_arc = Arc::from_raw(lparam.0 as *const Mutex<EnumState>);
        // Re-clone the arc so it doesn't get dropped at the end of this function (until the overall EnumWindows finishes)
        let _state_clone = state_arc.clone();
        
        let process_window = || -> Option<()> {
            let mut state = state_arc.lock().ok()?;

            // Skip our own windows (main overlay and hitbox)
            if state.excluded_hwnds.contains(&(hwnd.0 as isize)) {
                return Some(());
            }

            // Must be visible
            if !IsWindowVisible(hwnd).as_bool() {
                return Some(());
            }

            let style = GetWindowLongW(hwnd, GWL_STYLE);
            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);

            // Check styles
            let window_style = WINDOW_STYLE(style as u32);
            if !window_style.contains(WS_VISIBLE) || window_style.contains(WS_MINIMIZE) {
                return Some(());
            }

            let window_ex_style = WINDOW_EX_STYLE(ex_style as u32);
            if window_ex_style.contains(WS_EX_TOOLWINDOW) {
                return Some(());
            }

            // Get title
            let len = GetWindowTextLengthW(hwnd);
            if len == 0 {
                return Some(());
            }

            let mut buf = vec![0u16; (len + 1) as usize];
            let copied = GetWindowTextW(hwnd, &mut buf);
            if copied == 0 {
                return Some(());
            }
            buf.truncate(copied as usize);
            let title = OsString::from_wide(&buf).to_string_lossy().to_string();

            // Get rect
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_ok() {
                state.windows.push(WinRect {
                    title,
                    x: rect.left,
                    y: rect.top,
                    w: rect.right - rect.left,
                    h: rect.bottom - rect.top,
                });
            }

            Some(())
        };

        process_window();
        
        // Forget the clone we made so it doesn't decrement the ref count to 0 while EnumWindows is running
        let _ = Arc::into_raw(state_arc);
        
        BOOL::from(true)
    }

    pub fn enumerate_windows(excluded_hwnds: &[isize]) -> DesktopSnapshot {
        let state = Arc::new(Mutex::new(EnumState {
            windows: Vec::new(),
            excluded_hwnds: excluded_hwnds.to_vec(),
        }));

        unsafe {
            let lparam = LPARAM(Arc::into_raw(state.clone()) as isize);
            let _ = EnumWindows(Some(enum_windows_callback), lparam);
            // Re-acquire the Arc to drop it properly
            let _ = Arc::from_raw(lparam.0 as *const Mutex<EnumState>);
        }

        let windows = state.lock().unwrap().windows.clone();

        // Get Taskbar position
        let mut taskbar = None;
        unsafe {
            // Find the taskbar window by its well-known class name
            if let Ok(taskbar_hwnd) = windows::Win32::UI::WindowsAndMessaging::FindWindowW(
                windows::core::w!("Shell_TrayWnd"),
                windows::core::PCWSTR::null(),
            ) {
                let mut rect = RECT::default();
                if GetWindowRect(taskbar_hwnd, &mut rect).is_ok() {
                    taskbar = Some(WinRect {
                        title: "Taskbar".to_string(),
                        x: rect.left,
                        y: rect.top,
                        w: rect.right - rect.left,
                        h: rect.bottom - rect.top,
                    });
                }
            }
        }

        DesktopSnapshot { windows, taskbar }
    }
}

#[cfg(not(target_os = "windows"))]
mod unix_impl {
    use super::DesktopSnapshot;

    pub fn enumerate_windows(_excluded_hwnds: &[isize]) -> DesktopSnapshot {
        // macOS / Linux stub
        DesktopSnapshot {
            windows: vec![],
            taskbar: None,
        }
    }
}

pub fn enumerate_windows(excluded_hwnds: &[isize]) -> DesktopSnapshot {
    #[cfg(target_os = "windows")]
    {
        windows_impl::enumerate_windows(excluded_hwnds)
    }
    #[cfg(not(target_os = "windows"))]
    {
        unix_impl::enumerate_windows(excluded_hwnds)
    }
}
