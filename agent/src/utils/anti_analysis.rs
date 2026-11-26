/// Anti-analysis checks: VM detection, debugger detection, sandbox evasion.
/// Feature-gated behind `anti_analysis`.

#[cfg(feature = "anti_analysis")]
pub fn run_checks() -> bool {
    if is_debugger_present() || is_vm() || is_sandbox() {
        return true; // threat detected
    }
    false
}

#[cfg(not(feature = "anti_analysis"))]
pub fn run_checks() -> bool {
    false
}

#[cfg(all(feature = "anti_analysis", target_os = "windows"))]
fn is_debugger_present() -> bool {
    unsafe {
        use winapi::um::debugapi::{IsDebuggerPresent, CheckRemoteDebuggerPresent};
        use winapi::um::processthreadsapi::GetCurrentProcess;

        if IsDebuggerPresent() != 0 {
            return true;
        }

        let mut remote: i32 = 0;
        CheckRemoteDebuggerPresent(GetCurrentProcess(), &mut remote);
        if remote != 0 {
            return true;
        }

        false
    }
}

#[cfg(all(feature = "anti_analysis", not(target_os = "windows")))]
fn is_debugger_present() -> bool {
    // Linux: check /proc/self/status for TracerPid
    if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
        for line in status.lines() {
            if line.starts_with("TracerPid:") {
                let pid = line.split(':').nth(1).unwrap_or("0").trim();
                if pid != "0" {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(all(feature = "anti_analysis", target_os = "windows"))]
fn is_vm() -> bool {
    use winapi::um::winreg::*;
    use winapi::shared::minwindef::HKEY;
    use winapi::um::winnt::*;
    use std::ptr;

    let vm_indicators = [
        "VMware", "VirtualBox", "VBOX", "QEMU", "Xen", "Hyper-V",
    ];

    // Check common VM processes
    let output = std::process::Command::new("tasklist")
        .output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: Vec::new(),
            stderr: Vec::new(),
        });
    let tasklist = String::from_utf8_lossy(&output.stdout).to_lowercase();
    let vm_processes = ["vmtoolsd", "vmwaretray", "vboxservice", "vboxtray", "qemu-ga"];
    for proc in &vm_processes {
        if tasklist.contains(proc) {
            return true;
        }
    }

    // Check registry for VM artifacts
    let vm_reg_keys = [
        "SYSTEM\\CurrentControlSet\\Services\\VMTools",
        "SOFTWARE\\VMware, Inc.\\VMware Tools",
        "SOFTWARE\\Oracle\\VirtualBox Guest Additions",
    ];

    unsafe {
        for key_path in &vm_reg_keys {
            let wide: Vec<u16> = key_path.encode_utf16().chain(std::iter::once(0)).collect();
            let mut hkey: HKEY = ptr::null_mut();
            if RegOpenKeyExW(HKEY_LOCAL_MACHINE, wide.as_ptr(), 0, KEY_READ, &mut hkey) == 0 {
                RegCloseKey(hkey);
                return true;
            }
        }
    }

    false
}

#[cfg(all(feature = "anti_analysis", not(target_os = "windows")))]
fn is_vm() -> bool {
    // Check DMI/BIOS strings on Linux
    let paths = [
        "/sys/class/dmi/id/product_name",
        "/sys/class/dmi/id/sys_vendor",
        "/sys/class/dmi/id/board_vendor",
    ];
    let indicators = ["vmware", "virtualbox", "qemu", "kvm", "xen", "hyper-v"];

    for path in &paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            let lower = content.to_lowercase();
            for ind in &indicators {
                if lower.contains(ind) {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(feature = "anti_analysis")]
fn is_sandbox() -> bool {
    // Check username for sandbox indicators
    let suspicious_users = ["sandbox", "malware", "virus", "sample", "test", "analyst", "john doe"];
    let username = whoami().to_lowercase();
    for s in &suspicious_users {
        if username.contains(s) {
            return true;
        }
    }

    // Check for low resources (common in sandboxes)
    #[cfg(target_os = "windows")]
    {
        unsafe {
            use winapi::um::sysinfoapi::{GetSystemInfo, SYSTEM_INFO};
            let mut si: SYSTEM_INFO = std::mem::zeroed();
            GetSystemInfo(&mut si);
            if si.dwNumberOfProcessors < 2 {
                return true;
            }
        }
    }

    // Check for low uptime (sandboxes often freshly booted)
    #[cfg(target_os = "linux")]
    {
        if let Ok(uptime) = std::fs::read_to_string("/proc/uptime") {
            if let Some(secs_str) = uptime.split_whitespace().next() {
                if let Ok(secs) = secs_str.parse::<f64>() {
                    if secs < 120.0 {
                        return true;
                    }
                }
            }
        }
    }

    false
}

#[cfg(feature = "anti_analysis")]
fn whoami() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default()
}
