use std::sync::Mutex;

/// Compile-time embedded configuration, with runtime-mutable fields for server-driven updates.
pub struct Config {
    pub server_url: String,
    pub aes_key: String,
    pub sleep_seconds: Mutex<u64>,
    pub jitter_percent: Mutex<u64>,
    pub killdate: i64,
    pub work_hours_start: (u32, u32),
    pub work_hours_end: (u32, u32),
    pub agent_id: String,
}

impl Config {
    pub fn embedded() -> Self {
        let sleep: u64 = env!("SG_SLEEP").parse().unwrap_or(5);
        let jitter: u64 = env!("SG_JITTER").parse().unwrap_or(20);
        let killdate: i64 = env!("SG_KILLDATE").parse().unwrap_or(0);

        let hours_str = env!("SG_WORK_HOURS");
        let (start, end) = parse_work_hours(hours_str);

        let agent_id = uuid::Uuid::new_v4().to_string();

        Config {
            server_url: env!("SG_SERVER_URL").to_string(),
            aes_key: env!("SG_AES_KEY").to_string(),
            sleep_seconds: Mutex::new(sleep),
            jitter_percent: Mutex::new(jitter),
            killdate,
            work_hours_start: start,
            work_hours_end: end,
            agent_id,
        }
    }

    pub fn get_sleep(&self) -> u64 {
        *self.sleep_seconds.lock().unwrap()
    }

    pub fn get_jitter(&self) -> u64 {
        *self.jitter_percent.lock().unwrap()
    }

    pub fn update_sleep(&self, s: u64) {
        *self.sleep_seconds.lock().unwrap() = s;
    }

    pub fn update_jitter(&self, j: u64) {
        *self.jitter_percent.lock().unwrap() = j;
    }

    pub fn is_killdate_expired(&self) -> bool {
        if self.killdate == 0 {
            return false;
        }
        chrono::Utc::now().timestamp() >= self.killdate
    }

    pub fn is_within_work_hours(&self) -> bool {
        let now = chrono::Local::now();
        let current_minutes = now.hour() * 60 + now.minute();
        let start_minutes = self.work_hours_start.0 * 60 + self.work_hours_start.1;
        let end_minutes = self.work_hours_end.0 * 60 + self.work_hours_end.1;
        current_minutes >= start_minutes && current_minutes <= end_minutes
    }
}

fn parse_work_hours(s: &str) -> ((u32, u32), (u32, u32)) {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 2 {
        return ((0, 0), (23, 59));
    }
    let start = parse_hm(parts[0]);
    let end = parse_hm(parts[1]);
    (start, end)
}

fn parse_hm(s: &str) -> (u32, u32) {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        return (0, 0);
    }
    let h: u32 = parts[0].parse().unwrap_or(0);
    let m: u32 = parts[1].parse().unwrap_or(0);
    (h, m)
}

use chrono::Timelike;
