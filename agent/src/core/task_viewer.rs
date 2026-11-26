/// Task viewer: list running processes, kill processes.

use super::TaskResult;
use serde_json::json;

pub fn list_processes(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        list_processes_windows(task_id)
    }
    #[cfg(target_os = "linux")]
    {
        list_processes_linux(task_id)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        TaskResult::error(task_id, "process listing not supported on this platform".to_string())
    }
}

pub fn kill_process(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let pid = match args.get("pid").and_then(|v| v.as_u64()) {
        Some(p) => p as u32,
        None => return TaskResult::error(task_id, "missing 'pid' argument".to_string()),
    };

    #[cfg(target_os = "windows")]
    {
        kill_process_windows(task_id, pid)
    }
    #[cfg(target_os = "linux")]
    {
        kill_process_linux(task_id, pid)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        TaskResult::error(task_id, "process kill not supported on this platform".to_string())
    }
}

#[cfg(target_os = "windows")]
fn list_processes_windows(task_id: i64) -> TaskResult {
    unsafe {
        use winapi::um::tlhelp32::*;
        use winapi::um::handleapi::CloseHandle;
        use winapi::shared::minwindef::FALSE;

        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap.is_null() || snap == winapi::um::handleapi::INVALID_HANDLE_VALUE {
            return TaskResult::error(task_id, "CreateToolhelp32Snapshot failed".to_string());
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        let mut processes = Vec::new();

        if Process32FirstW(snap, &mut entry) != FALSE {
            loop {
                let name = String::from_utf16_lossy(
                    &entry.szExeFile[..entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len())],
                );

                processes.push(json!({
                    "pid": entry.th32ProcessID,
                    "name": name,
                    "parent_pid": entry.th32ParentProcessID,
                    "threads": entry.cntThreads,
                }));

                if Process32NextW(snap, &mut entry) == FALSE {
                    break;
                }
            }
        }

        CloseHandle(snap);
        TaskResult::success(task_id, serde_json::to_string(&processes).unwrap_or_default())
    }
}

#[cfg(target_os = "linux")]
fn list_processes_linux(task_id: i64) -> TaskResult {
    let mut processes = Vec::new();

    if let Ok(entries) = std::fs::read_dir("/proc") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Ok(pid) = name.parse::<u32>() {
                let comm = std::fs::read_to_string(format!("/proc/{}/comm", pid))
                    .unwrap_or_else(|_| "unknown".to_string())
                    .trim()
                    .to_string();

                let status = std::fs::read_to_string(format!("/proc/{}/status", pid))
                    .unwrap_or_default();

                let mut user = "unknown".to_string();
                let mut mem_kb: u64 = 0;
                for line in status.lines() {
                    if line.starts_with("Uid:") {
                        if let Some(uid_str) = line.split_whitespace().nth(1) {
                            user = uid_str.to_string();
                        }
                    }
                    if line.starts_with("VmRSS:") {
                        if let Some(kb_str) = line.split_whitespace().nth(1) {
                            mem_kb = kb_str.parse().unwrap_or(0);
                        }
                    }
                }

                processes.push(json!({
                    "pid": pid,
                    "name": comm,
                    "user": user,
                    "memory_mb": mem_kb / 1024,
                }));
            }
        }
    }

    TaskResult::success(task_id, serde_json::to_string(&processes).unwrap_or_default())
}

#[cfg(target_os = "windows")]
fn kill_process_windows(task_id: i64, pid: u32) -> TaskResult {
    unsafe {
        use winapi::um::processthreadsapi::OpenProcess;
        use winapi::um::processthreadsapi::TerminateProcess;
        use winapi::um::handleapi::CloseHandle;
        use winapi::um::winnt::PROCESS_TERMINATE;

        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if handle.is_null() {
            return TaskResult::error(task_id, format!("cannot open process {}", pid));
        }

        let result = TerminateProcess(handle, 1);
        CloseHandle(handle);

        if result != 0 {
            TaskResult::success(task_id, format!("killed process {}", pid))
        } else {
            TaskResult::error(task_id, format!("TerminateProcess failed for {}", pid))
        }
    }
}

#[cfg(target_os = "linux")]
fn kill_process_linux(task_id: i64, pid: u32) -> TaskResult {
    unsafe {
        let result = libc::kill(pid as i32, libc::SIGKILL);
        if result == 0 {
            TaskResult::success(task_id, format!("killed process {}", pid))
        } else {
            TaskResult::error(task_id, format!("kill failed for pid {}: errno {}", pid, *libc::__errno_location()))
        }
    }
}
