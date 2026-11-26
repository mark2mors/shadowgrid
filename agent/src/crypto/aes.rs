/// AES-256-GCM encryption/decryption matching the Go server implementation.
///
/// Format:
///   Encrypt: random 12-byte nonce + AES-GCM ciphertext+tag → base64 standard encoding
///   Decrypt: base64 decode → first 12 bytes = nonce, rest = ciphertext+tag → plaintext
///   Key: 64-char hex string → 32 bytes

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, AeadCore,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

/// Decrypt a base64-encoded ciphertext using the hex-encoded AES key.
/// Matches Go: base64.StdEncoding.DecodeString → split nonce (12) | ciphertext → gcm.Open
pub fn decrypt(encoded: &str, key_hex: &str) -> Result<Vec<u8>, String> {
    let key_bytes = hex_decode(key_hex)?;
    let combined = BASE64.decode(encoded).map_err(|e| format!("base64 decode: {}", e))?;

    if combined.len() < 12 {
        return Err("ciphertext too short".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = aes_gcm::Nonce::from_slice(nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("cipher init: {}", e))?;

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("decrypt: {}", e))
}

/// Encrypt plaintext and return base64-encoded result.
/// Matches Go: random 12-byte nonce, gcm.Seal(nonce, nonce, plaintext, nil) → base64
pub fn encrypt(plaintext: &[u8], key_hex: &str) -> Result<String, String> {
    let key_bytes = hex_decode(key_hex)?;

    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("cipher init: {}", e))?;

    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("encrypt: {}", e))?;

    // Prepend nonce to ciphertext (matches Go: gcm.Seal(nonce, nonce, plaintext, nil))
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce);
    combined.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(&combined))
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err("hex string has odd length".to_string());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| format!("hex decode: {}", e)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip() {
        let key_hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let plaintext = b"hello world";
        let encrypted = encrypt(plaintext, key_hex).unwrap();
        let decrypted = decrypt(&encrypted, key_hex).unwrap();
        assert_eq!(decrypted, plaintext);
    }
}
