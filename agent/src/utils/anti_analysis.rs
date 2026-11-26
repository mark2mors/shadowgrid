/// Anti-analysis checks: debugger detection, sandbox evasion, analysis tool detection.
/// Feature-gated behind `anti_analysis`.
///
/// Only flags actual analysis environments (debuggers attached, known sandboxes, analysis tools).
/// Normal VMs (Hyper-V, VMware Workstation, VirtualBox for personal use) are NOT flagged.

#[cfg(feature = "anti_analysis")]
pub fn run_checks() -> bool {
    // Real threats: debugger attached, known sandbox, or analysis tools running
    if is_debugger_present() || is_sandbox() || has_analysis_tools() {
        return true;
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

/// Check for known analysis tools running on the system.
/// These indicate active reverse-engineering / malware analysis.
#[cfg(all(feature = "anti_analysis", target_os = "windows"))]
fn has_analysis_tools() -> bool {
    let output = std::process::Command::new("tasklist")
        .output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: Vec::new(),
            stderr: Vec::new(),
        });
    let tasklist = String::from_utf8_lossy(&output.stdout).to_lowercase();

    // Analysis tools: debuggers, disassemblers, network analyzers, process monitors
    let analysis_processes = [
        // Debuggers
        "x64dbg", "x32dbg", "ollydbg", "windbg", "devenv",
        // Disassemblers / RE tools
        "ida", "ida64", "idag", "idag64", "idaw", "idaw64",
        "ghidra", "ghidrarun", "binaryninja", "radare2", "r2",
        "cutter",
        // Network analysis
        "wireshark", "tshark", "fiddler", "burpsuite",
        "charles", "mitmproxy",
        // Process / system monitors
        "procmon", "procmon64", "procexp", "procexp64",
        "processhacker", "tcpview",
        // Sandbox / AV analysis
        "fakenet", "regshot", "autoruns",
        "pestudio", "die", "exeinfope",
        // API monitoring
        "apimonitor", "api_monitor",
    ];

    for proc in &analysis_processes {
        if tasklist.contains(proc) {
            return true;
        }
    }

    false
}

#[cfg(all(feature = "anti_analysis", not(target_os = "windows")))]
fn has_analysis_tools() -> bool {
    // Check for common Linux analysis tools
    if let Ok(output) = std::process::Command::new("ps").args(&["-eo", "comm"]).output() {
        let ps_output = String::from_utf8_lossy(&output.stdout).to_lowercase();
        let analysis_tools = [
            "strace", "ltrace", "gdb", "radare2", "r2",
            "ghidra", "ida", "wireshark", "tshark", "tcpdump",
        ];
        for tool in &analysis_tools {
            if ps_output.contains(tool) {
                return true;
            }
        }
    }
    false
}

#[cfg(feature = "anti_analysis")]
fn is_sandbox() -> bool {
    // Check username for known sandbox/analysis environment indicators
    let sandbox_users = [
        "sandbox", "malware", "virus", "sample", "analyst",
        "john doe", "currentuser", "user", "cuckoo", "honey",
        "vmuser", "sandbox", "maltest", "malwarelab",
    ];
    let username = whoami().to_lowercase();
    for s in &sandbox_users {
        if username == *s {
            return true;
        }
    }

    // Check hostname for known sandbox hostnames
    let hostname = get_hostname().to_lowercase();
    let sandbox_hostnames = [
        "sandbox", "malware", "cuckoo", "anyrun", "hybrid-analysis",
        "sample", "virus", "analysis",
    ];
    for s in &sandbox_hostnames {
        if hostname.contains(s) {
            return true;
        }
    }

    // Check for very low resources (common in automated sandboxes, not real machines)
    #[cfg(target_os = "windows")]
    {
        unsafe {
            use winapi::um::sysinfoapi::{GetSystemInfo, SYSTEM_INFO};
            let mut si: SYSTEM_INFO = std::mem::zeroed();
            GetSystemInfo(&mut si);
            // Only 1 CPU is a strong sandbox indicator; 2 CPUs is normal for VMs
            if si.dwNumberOfProcessors < 2 {
                return true;
            }
        }
    }

    // Check for very low uptime (sandboxes are freshly booted)
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

#[cfg(feature = "anti_analysis")]
fn get_hostname() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMPUTERNAME").unwrap_or_default()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::fs::read_to_string("/etc/hostname")
            .unwrap_or_default()
            .trim()
            .to_string()
    }
}
