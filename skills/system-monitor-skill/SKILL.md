---
name: System Monitor
description: Get system information including CPU, memory, disk usage, top processes, network, and uptime
script: scripts/main.sh
language: bash
install: none
timeout: 15
---
# System Monitor

Gather system information across multiple categories. Works on both Linux and macOS.

## Input

- `sections` (array of string, optional, default all): Which sections to include — "cpu", "memory", "disk", "processes", "network", "uptime", "os"
- `process_count` (int, optional, default 10): Number of top processes to return (sorted by CPU usage)

## Output

- `cpu`: `{ cores, model, usage_percent, load_avg: [1min, 5min, 15min] }`
- `memory`: `{ total_mb, used_mb, available_mb, usage_percent }`
- `disk`: `{ filesystems: [{ mount, total_gb, used_gb, available_gb, usage_percent }] }`
- `processes`: Top N processes by CPU: `[{ pid, user, cpu_percent, mem_percent, command }]`
- `network`: `{ interfaces: [{ name, ip, mac }] }`
- `uptime`: `{ uptime_seconds, uptime_human, boot_time }`
- `os`: `{ name, version, hostname, kernel }`

## Examples

Get all system info:
```json
{}
```

Get specific sections:
```json
{ "sections": ["cpu", "memory", "disk"] }
```

Get top 5 processes:
```json
{ "sections": ["processes"], "process_count": 5 }
```
