use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, Read};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Deserialize)]
struct Input {
    token: String,
}

#[derive(Serialize)]
struct Output {
    header: Value,
    payload: Value,
    expired: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    issued_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<String>,
}

/// Decode a base64url-encoded string (JWT uses base64url without padding)
fn decode_base64url(input: &str) -> Result<Vec<u8>, String> {
    // base64url: replace - with + and _ with /, then add padding
    let mut s = input.replace('-', "+").replace('_', "/");

    // Add padding if needed
    let padding = (4 - s.len() % 4) % 4;
    for _ in 0..padding {
        s.push('=');
    }

    general_purpose::STANDARD
        .decode(s.as_bytes())
        .map_err(|e| format!("Base64 decode failed: {}", e))
}

/// Convert a UNIX timestamp to an ISO 8601 string
fn unix_to_iso8601(timestamp: i64) -> String {
    let secs = timestamp;
    let days_from_epoch = secs / 86400;
    let time_of_day = secs % 86400;

    // Calculate date from days since epoch (1970-01-01)
    let mut remaining_days = days_from_epoch;
    let mut year: i64 = 1970;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let days_in_months: [i64; 12] = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 0;
    for (i, &days) in days_in_months.iter().enumerate() {
        if remaining_days < days {
            month = i;
            break;
        }
        remaining_days -= days;
    }

    let day = remaining_days + 1;
    let hour = time_of_day / 3600;
    let minute = (time_of_day % 3600) / 60;
    let second = time_of_day % 60;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year,
        month + 1,
        day,
        hour,
        minute,
        second
    )
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn main() {
    let mut input_str = String::new();
    io::stdin()
        .read_to_string(&mut input_str)
        .expect("Failed to read stdin");

    let input: Input = match serde_json::from_str(&input_str) {
        Ok(v) => v,
        Err(e) => {
            let err = serde_json::json!({"error": format!("Invalid input: {}", e)});
            println!("{}", err);
            return;
        }
    };

    let token = input.token.trim();

    // Split JWT by '.'
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        let err = serde_json::json!({
            "error": format!("Invalid JWT: expected 3 parts separated by '.', got {}", parts.len())
        });
        println!("{}", err);
        return;
    }

    // Decode header
    let header_bytes = match decode_base64url(parts[0]) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("Header decode error: {}", e);
            let err = serde_json::json!({"error": format!("Failed to decode JWT header: {}", e)});
            println!("{}", err);
            return;
        }
    };

    let header: Value = match serde_json::from_slice(&header_bytes) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Header JSON parse error: {}", e);
            let err =
                serde_json::json!({"error": format!("Failed to parse JWT header as JSON: {}", e)});
            println!("{}", err);
            return;
        }
    };

    // Decode payload
    let payload_bytes = match decode_base64url(parts[1]) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("Payload decode error: {}", e);
            let err =
                serde_json::json!({"error": format!("Failed to decode JWT payload: {}", e)});
            println!("{}", err);
            return;
        }
    };

    let payload: Value = match serde_json::from_slice(&payload_bytes) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Payload JSON parse error: {}", e);
            let err = serde_json::json!({"error": format!("Failed to parse JWT payload as JSON: {}", e)});
            println!("{}", err);
            return;
        }
    };

    // Check expiration
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let expired = if let Some(exp) = payload.get("exp") {
        if let Some(exp_val) = exp.as_i64() {
            exp_val < now
        } else if let Some(exp_val) = exp.as_f64() {
            (exp_val as i64) < now
        } else {
            false
        }
    } else {
        false
    };

    // Extract issued_at
    let issued_at = payload.get("iat").and_then(|iat| {
        iat.as_i64()
            .or_else(|| iat.as_f64().map(|f| f as i64))
            .map(unix_to_iso8601)
    });

    // Extract expires_at
    let expires_at = payload.get("exp").and_then(|exp| {
        exp.as_i64()
            .or_else(|| exp.as_f64().map(|f| f as i64))
            .map(unix_to_iso8601)
    });

    let output = Output {
        header,
        payload,
        expired,
        issued_at,
        expires_at,
    };

    println!("{}", serde_json::to_string(&output).unwrap());
}
