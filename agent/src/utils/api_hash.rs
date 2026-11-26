/// API hashing: resolve Windows API functions by hash instead of importing them.
/// Walks the PEB to find loaded modules and their exports, matching by djb2 hash.
/// This avoids plaintext API names in the import table.
///
/// Feature-gated behind `evasion`, Windows-only.

/// djb2 hash of a byte slice (case-insensitive for module names).
pub const fn hash_name(name: &[u8]) -> u32 {
    let mut hash: u32 = 5381;
    let mut i = 0;
    while i < name.len() {
        hash = hash.wrapping_mul(33).wrapping_add(name[i] as u32);
        i += 1;
    }
    hash
}

/// djb2 hash of a byte slice, case-insensitive (for module name matching).
pub const fn hash_name_ci(name: &[u8]) -> u32 {
    let mut hash: u32 = 5381;
    let mut i = 0;
    while i < name.len() {
        let b = if name[i] >= b'a' && name[i] <= b'z' {
            name[i] - 32 // to uppercase
        } else {
            name[i]
        };
        hash = hash.wrapping_mul(33).wrapping_add(b as u32);
        i += 1;
    }
    hash
}

// Pre-computed hashes for modules (case-insensitive)
pub const H_KERNEL32: u32 = hash_name_ci(b"kernel32.dll");
pub const H_NTDLL: u32 = hash_name_ci(b"ntdll.dll");
pub const H_ADVAPI32: u32 = hash_name_ci(b"advapi32.dll");

// Pre-computed hashes for functions (case-sensitive)
pub const H_VIRTUAL_PROTECT: u32 = hash_name(b"VirtualProtect");
pub const H_VIRTUAL_ALLOC: u32 = hash_name(b"VirtualAlloc");
pub const H_VIRTUAL_FREE: u32 = hash_name(b"VirtualFree");
pub const H_LOAD_LIBRARY_A: u32 = hash_name(b"LoadLibraryA");
pub const H_GET_PROC_ADDRESS: u32 = hash_name(b"GetProcAddress");
pub const H_GET_MODULE_HANDLE_A: u32 = hash_name(b"GetModuleHandleA");

#[cfg(target_os = "windows")]
mod win {
    use super::*;

    /// Resolve a function from a loaded module by walking the PEB.
    ///
    /// # Safety
    /// Reads raw PEB/PE structures from memory. Only safe when module_hash and
    /// func_hash correspond to a valid loaded module and exported function.
    pub unsafe fn get_proc_by_hash(module_hash: u32, func_hash: u32) -> Option<*const ()> {
        // Get PEB address: on x86_64 Windows, gs:[0x60] -> PEB
        let peb: *const u8;
        #[cfg(target_arch = "x86_64")]
        {
            core::arch::asm!(
                "mov {}, gs:[0x60]",
                out(reg) peb,
                options(nostack, nomem, preserves_flags),
            );
        }
        #[cfg(target_arch = "x86")]
        {
            core::arch::asm!(
                "mov {}, fs:[0x30]",
                out(reg) peb,
                options(nostack, nomem, preserves_flags),
            );
        }

        if peb.is_null() {
            return None;
        }

        // PEB->Ldr is at offset 0x18 (x64) or 0x0C (x86)
        #[cfg(target_arch = "x86_64")]
        let ldr = *(peb.add(0x18) as *const *const u8);
        #[cfg(target_arch = "x86")]
        let ldr = *(peb.add(0x0C) as *const *const u8);

        if ldr.is_null() {
            return None;
        }

        // PEB_LDR_DATA->InMemoryOrderModuleList is at offset 0x20 (x64) or 0x14 (x86)
        #[cfg(target_arch = "x86_64")]
        let list_head = ldr.add(0x20) as *const ListEntry;
        #[cfg(target_arch = "x86")]
        let list_head = ldr.add(0x14) as *const ListEntry;

        let mut entry = (*list_head).flink;

        while entry != list_head {
            // LDR_DATA_TABLE_ENTRY: InMemoryOrderLinks is at the start
            // DllBase is at offset 0x20 (after InMemoryOrderLinks + 2 more fields) on x64
            // BaseDllName (UNICODE_STRING) is at offset 0x58 (x64) or 0x2C (x86)
            // from the start of InMemoryOrderLinks
            #[cfg(target_arch = "x86_64")]
            let dll_base = *((entry as *const u8).add(0x20) as *const *const u8);
            #[cfg(target_arch = "x86")]
            let dll_base = *((entry as *const u8).add(0x10) as *const *const u8);

            #[cfg(target_arch = "x86_64")]
            let name_ptr = (entry as *const u8).add(0x48);
            #[cfg(target_arch = "x86")]
            let name_ptr = (entry as *const u8).add(0x24);

            if !dll_base.is_null() {
                let name_len = *(name_ptr as *const u16) as usize / 2;
                let name_buf = *((name_ptr as *const u8).add(std::mem::size_of::<usize>() + 2)
                    as *const *const u16);

                if !name_buf.is_null() && name_len > 0 {
                    // Hash the module name (case-insensitive, wide chars)
                    let mod_hash = hash_wide_ci(name_buf, name_len);
                    if mod_hash == module_hash {
                        // Found the module — now find the export
                        if let Some(addr) = find_export(dll_base, func_hash) {
                            return Some(addr as *const ());
                        }
                    }
                }
            }

            entry = (*entry).flink;
        }

        None
    }

    /// Hash a wide (UTF-16) string case-insensitively using djb2.
    unsafe fn hash_wide_ci(buf: *const u16, len: usize) -> u32 {
        let mut hash: u32 = 5381;
        for i in 0..len {
            let mut c = *buf.add(i) as u8;
            if c >= b'a' && c <= b'z' {
                c -= 32;
            }
            hash = hash.wrapping_mul(33).wrapping_add(c as u32);
        }
        hash
    }

    /// Parse PE export table and find a function by hash.
    unsafe fn find_export(dll_base: *const u8, func_hash: u32) -> Option<*const u8> {
        // DOS header -> e_lfanew at offset 0x3C
        let e_lfanew = *(dll_base.add(0x3C) as *const u32) as usize;
        let nt_headers = dll_base.add(e_lfanew);

        // PE signature + FileHeader(20) + OptionalHeader
        // Export directory RVA is in OptionalHeader.DataDirectory[0]
        #[cfg(target_arch = "x86_64")]
        let export_rva = *(nt_headers.add(0x88) as *const u32) as usize; // 24 + 112
        #[cfg(target_arch = "x86")]
        let export_rva = *(nt_headers.add(0x78) as *const u32) as usize; // 24 + 96

        if export_rva == 0 {
            return None;
        }

        let export_dir = dll_base.add(export_rva);

        let num_names = *(export_dir.add(0x18) as *const u32) as usize;
        let addr_table_rva = *(export_dir.add(0x1C) as *const u32) as usize;
        let name_table_rva = *(export_dir.add(0x20) as *const u32) as usize;
        let ordinal_table_rva = *(export_dir.add(0x24) as *const u32) as usize;

        let addr_table = dll_base.add(addr_table_rva) as *const u32;
        let name_table = dll_base.add(name_table_rva) as *const u32;
        let ordinal_table = dll_base.add(ordinal_table_rva) as *const u16;

        for i in 0..num_names {
            let name_rva = *name_table.add(i) as usize;
            let name_ptr = dll_base.add(name_rva);

            // Get name length (find null terminator)
            let mut len = 0usize;
            while *name_ptr.add(len) != 0 {
                len += 1;
                if len > 256 {
                    break;
                }
            }

            let name_slice = std::slice::from_raw_parts(name_ptr, len);
            let h = hash_name(name_slice);

            if h == func_hash {
                let ordinal = *ordinal_table.add(i) as usize;
                let func_rva = *addr_table.add(ordinal) as usize;
                return Some(dll_base.add(func_rva));
            }
        }

        None
    }

    #[repr(C)]
    struct ListEntry {
        flink: *const ListEntry,
        blink: *const ListEntry,
    }
}

#[cfg(target_os = "windows")]
pub use win::get_proc_by_hash;

/// Convenience: resolve and transmute a function pointer from PEB.
///
/// # Safety
/// The caller must ensure the target function signature matches the type parameter.
#[cfg(target_os = "windows")]
pub unsafe fn resolve<T>(module_hash: u32, func_hash: u32) -> Option<T> {
    get_proc_by_hash(module_hash, func_hash).map(|ptr| std::mem::transmute_copy(&ptr))
}
