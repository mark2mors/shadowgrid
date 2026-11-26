use std::env;

fn main() {
    // Embed compile-time configuration via environment variables
    // These can be overridden at build time:
    //   SG_SERVER_URL, SG_AES_KEY, SG_SLEEP, SG_JITTER, SG_KILLDATE, SG_WORK_HOURS
    println!("cargo:rerun-if-env-changed=SG_SERVER_URL");
    println!("cargo:rerun-if-env-changed=SG_AES_KEY");
    println!("cargo:rerun-if-env-changed=SG_SLEEP");
    println!("cargo:rerun-if-env-changed=SG_JITTER");
    println!("cargo:rerun-if-env-changed=SG_KILLDATE");
    println!("cargo:rerun-if-env-changed=SG_WORK_HOURS");

    let server_url = env::var("SG_SERVER_URL").unwrap_or_else(|_| "https://127.0.0.1:8443".to_string());
    let aes_key = env::var("SG_AES_KEY").unwrap_or_else(|_| "0000000000000000000000000000000000000000000000000000000000000000".to_string());
    let sleep = env::var("SG_SLEEP").unwrap_or_else(|_| "5".to_string());
    let jitter = env::var("SG_JITTER").unwrap_or_else(|_| "20".to_string());
    let killdate = env::var("SG_KILLDATE").unwrap_or_else(|_| "0".to_string());
    let work_hours = env::var("SG_WORK_HOURS").unwrap_or_else(|_| "00:00-23:59".to_string());

    println!("cargo:rustc-env=SG_SERVER_URL={}", server_url);
    println!("cargo:rustc-env=SG_AES_KEY={}", aes_key);
    println!("cargo:rustc-env=SG_SLEEP={}", sleep);
    println!("cargo:rustc-env=SG_JITTER={}", jitter);
    println!("cargo:rustc-env=SG_KILLDATE={}", killdate);
    println!("cargo:rustc-env=SG_WORK_HOURS={}", work_hours);
}
