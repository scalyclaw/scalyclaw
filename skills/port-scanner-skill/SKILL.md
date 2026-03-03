---
name: Port Scanner
description: Scan TCP ports on a host to find open ports using async connections
script: target/release/port-scanner-skill
language: rust
install: cargo build --release
timeout: 30
---

# Port Scanner

Scan TCP ports on a specified host to determine which ports are open. Uses async Tokio TCP connections with configurable timeouts. Can scan specific ports or a range.

## Input
- `host` (string): The hostname or IP address to scan
- `ports` (array of integers, optional): Specific ports to scan
- `range_start` (integer, optional): Start of port range to scan (default: 1)
- `range_end` (integer, optional): End of port range to scan (default: 1024)
- `timeout_ms` (integer, optional): Connection timeout in milliseconds (default: 1000)

## Output
- `open_ports` (array of integers): List of open ports found
- `closed_count` (integer): Number of closed/filtered ports
- `host` (string): The host that was scanned
- `scan_time_ms` (integer): Total scan time in milliseconds
