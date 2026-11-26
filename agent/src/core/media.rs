/// Media module — removed. Webcam capture is not available.

use super::TaskResult;

pub fn capture(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    TaskResult::error(task_id, "module not available".to_string())
}
