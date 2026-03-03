use serde::{Deserialize, Serialize};
use std::io::{self, Read};
use std::net::ToSocketAddrs;
use std::time::Instant;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

#[derive(Deserialize)]
struct Input {
    host: String,
    ports: Option<Vec<u16>>,
    range_start: Option<u16>,
    range_end: Option<u16>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
struct Output {
    open_ports: Vec<u16>,
    closed_count: usize,
    host: String,
    scan_time_ms: u64,
}

async fn scan_port(host: &str, port: u16, timeout_duration: Duration) -> bool {
    let addr = format!("{}:{}", host, port);

    // Resolve the address first
    let socket_addr = match addr.to_socket_addrs() {
        Ok(mut addrs) => match addrs.next() {
            Some(a) => a,
            None => return false,
        },
        Err(_) => return false,
    };

    match timeout(timeout_duration, TcpStream::connect(socket_addr)).await {
        Ok(Ok(_stream)) => true,
        _ => false,
    }
}

#[tokio::main]
async fn main() {
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

    let host = input.host.trim().to_string();
    if host.is_empty() {
        let err = serde_json::json!({"error": "Host cannot be empty"});
        println!("{}", err);
        return;
    }

    let timeout_ms = input.timeout_ms.unwrap_or(1000);
    let timeout_duration = Duration::from_millis(timeout_ms);

    // Determine which ports to scan
    let ports: Vec<u16> = if let Some(ref specific_ports) = input.ports {
        specific_ports.clone()
    } else {
        let start = input.range_start.unwrap_or(1);
        let end = input.range_end.unwrap_or(1024);
        if start > end {
            let err = serde_json::json!({
                "error": format!("range_start ({}) must be <= range_end ({})", start, end)
            });
            println!("{}", err);
            return;
        }
        (start..=end).collect()
    };

    let total_ports = ports.len();
    eprintln!(
        "Scanning {} ports on {} with {}ms timeout...",
        total_ports, host, timeout_ms
    );

    let start_time = Instant::now();

    // Scan all ports concurrently using tokio tasks
    // Limit concurrency to avoid overwhelming the system
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(256));
    let mut handles = Vec::with_capacity(total_ports);

    for port in ports {
        let host_clone = host.clone();
        let sem = semaphore.clone();

        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let is_open = scan_port(&host_clone, port, timeout_duration).await;
            (port, is_open)
        });

        handles.push(handle);
    }

    let mut open_ports: Vec<u16> = Vec::new();
    let mut closed_count: usize = 0;

    for handle in handles {
        match handle.await {
            Ok((port, is_open)) => {
                if is_open {
                    eprintln!("Port {} is open", port);
                    open_ports.push(port);
                } else {
                    closed_count += 1;
                }
            }
            Err(e) => {
                eprintln!("Task error: {}", e);
                closed_count += 1;
            }
        }
    }

    // Sort open ports
    open_ports.sort();

    let scan_time_ms = start_time.elapsed().as_millis() as u64;

    eprintln!(
        "Scan complete: {} open, {} closed/filtered in {}ms",
        open_ports.len(),
        closed_count,
        scan_time_ms
    );

    let output = Output {
        open_ports,
        closed_count,
        host,
        scan_time_ms,
    };

    println!("{}", serde_json::to_string(&output).unwrap());
}
