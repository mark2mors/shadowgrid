/// Utility helpers: random IDs, base64, timestamps.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::Rng;

/// Generate a random alphanumeric string of given length.
pub fn random_string(len: usize) -> String {
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

/// Base64 encode bytes.
pub fn b64_encode(data: &[u8]) -> String {
    BASE64.encode(data)
}

/// Base64 decode string to bytes.
pub fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    BASE64.decode(s).map_err(|e| format!("base64 decode: {}", e))
}

/// Current UTC timestamp as Unix seconds.
pub fn timestamp() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Format a timestamp as ISO 8601.
pub fn format_timestamp(ts: i64) -> String {
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Create a Command with CREATE_NO_WINDOW on Windows to prevent console popups.
pub fn hidden_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Calculate sleep duration with enhanced jitter.
/// Adds random extra delay (0-120s) to break patterns.
/// 10% chance to double sleep (skip a check-in).
pub fn sleep_with_jitter(base_seconds: u64, jitter_percent: u64) -> u64 {
    if base_seconds == 0 {
        return base_seconds;
    }
    let mut rng = rand::thread_rng();

    // Base jitter calculation
    let mut result = if jitter_percent == 0 {
        base_seconds
    } else {
        let jitter_range = (base_seconds as f64 * jitter_percent as f64 / 100.0) as u64;
        if jitter_range == 0 {
            base_seconds
        } else {
            let offset = rng.gen_range(0..=jitter_range * 2);
            let r = base_seconds as i64 - jitter_range as i64 + offset as i64;
            r.max(1) as u64
        }
    };

    // Small random extra delay (0-5s) to break timing patterns
    result += rng.gen_range(0..=5);

    result
}
