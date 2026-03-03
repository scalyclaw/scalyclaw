#!/usr/bin/env bash
set -euo pipefail

# Read all stdin
INPUT=$(cat)

# Use python3 to parse input, gather system info, and output JSON
python3 -c '
import json, subprocess, sys, os, platform, re, time

def run_cmd(args, timeout=5):
    """Run a command and return stdout, or empty string on failure."""
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip()
    except Exception:
        return ""

def error_out(msg):
    print(json.dumps({"error": msg}))
    sys.exit(0)

# Parse input
try:
    data = json.loads(sys.stdin.read()) if not os.environ.get("_INPUT") else json.loads(os.environ["_INPUT"])
except Exception:
    data = {}

if not isinstance(data, dict):
    data = {}

all_sections = ["cpu", "memory", "disk", "processes", "network", "uptime", "os"]
sections = data.get("sections", all_sections)
if not isinstance(sections, list):
    sections = all_sections
process_count = data.get("process_count", 10)
if not isinstance(process_count, int) or process_count < 1:
    process_count = 10

is_mac = platform.system() == "Darwin"
is_linux = platform.system() == "Linux"
output = {}

# --- CPU ---
if "cpu" in sections:
    cpu_info = {}

    # Core count
    if is_mac:
        cores = run_cmd(["sysctl", "-n", "hw.ncpu"])
    else:
        cores = run_cmd(["nproc"])
    try:
        cpu_info["cores"] = int(cores)
    except (ValueError, TypeError):
        cpu_info["cores"] = 0

    # CPU model
    if is_mac:
        model = run_cmd(["sysctl", "-n", "machdep.cpu.brand_string"])
        if not model:
            model = run_cmd(["sysctl", "-n", "hw.model"])
    else:
        model = ""
        try:
            with open("/proc/cpuinfo", "r") as f:
                for line in f:
                    if "model name" in line:
                        model = line.split(":")[1].strip()
                        break
        except Exception:
            pass
    cpu_info["model"] = model or "Unknown"

    # Load average
    uptime_out = run_cmd(["uptime"])
    load_avg = [0.0, 0.0, 0.0]
    if uptime_out:
        match = re.search(r"load averages?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)", uptime_out)
        if match:
            try:
                load_avg = [float(match.group(1)), float(match.group(2)), float(match.group(3))]
            except ValueError:
                pass
    cpu_info["load_avg"] = load_avg

    # CPU usage estimate (from load avg vs cores)
    try:
        usage = round((load_avg[0] / max(cpu_info["cores"], 1)) * 100, 1)
        cpu_info["usage_percent"] = min(usage, 100.0)
    except Exception:
        cpu_info["usage_percent"] = 0.0

    output["cpu"] = cpu_info

# --- Memory ---
if "memory" in sections:
    mem_info = {}
    if is_mac:
        # Total memory
        total_bytes = run_cmd(["sysctl", "-n", "hw.memsize"])
        try:
            total_mb = int(total_bytes) / (1024 * 1024)
        except (ValueError, TypeError):
            total_mb = 0

        # vm_stat for used/available
        vm_stat = run_cmd(["vm_stat"])
        page_size = 4096  # default macOS page size
        ps_match = re.search(r"page size of (\d+) bytes", vm_stat)
        if ps_match:
            page_size = int(ps_match.group(1))

        def get_vm_pages(label):
            match = re.search(rf"{label}:\s+(\d+)", vm_stat)
            return int(match.group(1)) if match else 0

        free_pages = get_vm_pages("Pages free")
        active_pages = get_vm_pages("Pages active")
        inactive_pages = get_vm_pages("Pages inactive")
        speculative_pages = get_vm_pages("Pages speculative")
        wired_pages = get_vm_pages("Pages wired down")
        compressed_pages = get_vm_pages("Pages occupied by compressor")

        used_mb = round((active_pages + wired_pages + compressed_pages) * page_size / (1024 * 1024), 1)
        available_mb = round((free_pages + inactive_pages + speculative_pages) * page_size / (1024 * 1024), 1)
        total_mb = round(total_mb, 1)

    elif is_linux:
        total_mb = 0
        available_mb = 0
        try:
            with open("/proc/meminfo", "r") as f:
                meminfo = {}
                for line in f:
                    parts = line.split(":")
                    if len(parts) == 2:
                        key = parts[0].strip()
                        val = parts[1].strip().split()[0]  # value in kB
                        meminfo[key] = int(val)
                total_mb = round(meminfo.get("MemTotal", 0) / 1024, 1)
                available_mb = round(meminfo.get("MemAvailable", 0) / 1024, 1)
        except Exception:
            pass
        used_mb = round(total_mb - available_mb, 1)
    else:
        total_mb = 0
        used_mb = 0
        available_mb = 0

    usage_pct = round((used_mb / total_mb) * 100, 1) if total_mb > 0 else 0.0

    mem_info = {
        "total_mb": total_mb,
        "used_mb": used_mb,
        "available_mb": available_mb,
        "usage_percent": usage_pct,
    }
    output["memory"] = mem_info

# --- Disk ---
if "disk" in sections:
    df_out = run_cmd(["df", "-h"])
    filesystems = []
    if df_out:
        lines = df_out.split("\n")[1:]  # skip header
        for line in lines:
            parts = line.split()
            if len(parts) < 6:
                continue
            # Skip pseudo-filesystems
            mount = parts[-1]
            if mount.startswith("/dev") or mount.startswith("/System"):
                if not mount.startswith("/"):
                    continue
            # Parse size values
            def parse_size(s):
                """Parse human-readable size to GB."""
                s = s.strip()
                try:
                    if s.endswith("T") or s.endswith("Ti"):
                        return round(float(s.rstrip("Ti")) * 1024, 2)
                    elif s.endswith("G") or s.endswith("Gi"):
                        return round(float(s.rstrip("Gi")), 2)
                    elif s.endswith("M") or s.endswith("Mi"):
                        return round(float(s.rstrip("Mi")) / 1024, 2)
                    elif s.endswith("K") or s.endswith("Ki"):
                        return round(float(s.rstrip("Ki")) / (1024 * 1024), 4)
                    elif s.endswith("B"):
                        return round(float(s.rstrip("B")) / (1024 * 1024 * 1024), 6)
                    else:
                        return round(float(s), 2)
                except (ValueError, TypeError):
                    return 0.0

            # Standard df -h columns: Filesystem Size Used Avail Use% Mounted
            # macOS: Filesystem Size Used Avail Capacity iused ifree %iused Mounted
            if is_mac:
                if len(parts) >= 9:
                    total_gb = parse_size(parts[1])
                    used_gb = parse_size(parts[2])
                    avail_gb = parse_size(parts[3])
                    usage_str = parts[4].rstrip("%")
                    try:
                        usage_pct = float(usage_str)
                    except ValueError:
                        usage_pct = 0.0
                    mount = parts[8]
                else:
                    continue
            else:
                total_gb = parse_size(parts[1])
                used_gb = parse_size(parts[2])
                avail_gb = parse_size(parts[3])
                usage_str = parts[4].rstrip("%")
                try:
                    usage_pct = float(usage_str)
                except ValueError:
                    usage_pct = 0.0
                mount = parts[5]

            # Only include real filesystems
            if not mount.startswith("/"):
                continue
            filesystems.append({
                "mount": mount,
                "total_gb": total_gb,
                "used_gb": used_gb,
                "available_gb": avail_gb,
                "usage_percent": usage_pct,
            })

    output["disk"] = {"filesystems": filesystems}

# --- Processes ---
if "processes" in sections:
    if is_mac:
        ps_out = run_cmd(["ps", "aux", "-r"])  # -r sorts by CPU on macOS
    else:
        ps_out = run_cmd(["ps", "aux", "--sort=-%cpu"])

    processes = []
    if ps_out:
        lines = ps_out.split("\n")[1:]  # skip header
        for line in lines[:process_count]:
            parts = line.split(None, 10)
            if len(parts) >= 11:
                try:
                    processes.append({
                        "pid": int(parts[1]),
                        "user": parts[0],
                        "cpu_percent": float(parts[2]),
                        "mem_percent": float(parts[3]),
                        "command": parts[10],
                    })
                except (ValueError, IndexError):
                    continue

    output["processes"] = processes

# --- Network ---
if "network" in sections:
    interfaces = []
    if is_mac:
        ifconfig_out = run_cmd(["ifconfig"])
        if ifconfig_out:
            current_iface = None
            current_ip = None
            current_mac = None
            for line in ifconfig_out.split("\n"):
                # Interface header (e.g., "en0: flags=...")
                iface_match = re.match(r"^(\w+):\s+flags=", line)
                if iface_match:
                    if current_iface and (current_ip or current_mac):
                        interfaces.append({
                            "name": current_iface,
                            "ip": current_ip or "",
                            "mac": current_mac or "",
                        })
                    current_iface = iface_match.group(1)
                    current_ip = None
                    current_mac = None
                elif "inet " in line and current_iface:
                    ip_match = re.search(r"inet\s+([\d.]+)", line)
                    if ip_match:
                        current_ip = ip_match.group(1)
                elif "ether " in line and current_iface:
                    mac_match = re.search(r"ether\s+([\w:]+)", line)
                    if mac_match:
                        current_mac = mac_match.group(1)
            # Last interface
            if current_iface and (current_ip or current_mac):
                interfaces.append({
                    "name": current_iface,
                    "ip": current_ip or "",
                    "mac": current_mac or "",
                })
    else:
        # Linux: try ip addr first, fall back to ifconfig
        ip_out = run_cmd(["ip", "-o", "addr", "show"])
        if ip_out:
            seen = {}
            for line in ip_out.split("\n"):
                parts = line.split()
                if len(parts) >= 4 and parts[2] == "inet":
                    iface = parts[1]
                    ip_addr = parts[3].split("/")[0]
                    if iface not in seen:
                        # Get MAC
                        link_out = run_cmd(["ip", "link", "show", iface])
                        mac = ""
                        mac_match = re.search(r"link/ether\s+([\w:]+)", link_out)
                        if mac_match:
                            mac = mac_match.group(1)
                        seen[iface] = True
                        interfaces.append({"name": iface, "ip": ip_addr, "mac": mac})
        else:
            ifconfig_out = run_cmd(["ifconfig"])
            if ifconfig_out:
                current_iface = None
                current_ip = None
                current_mac = None
                for line in ifconfig_out.split("\n"):
                    iface_match = re.match(r"^(\w+):", line)
                    if iface_match:
                        if current_iface and (current_ip or current_mac):
                            interfaces.append({
                                "name": current_iface,
                                "ip": current_ip or "",
                                "mac": current_mac or "",
                            })
                        current_iface = iface_match.group(1)
                        current_ip = None
                        current_mac = None
                    elif "inet " in line:
                        ip_match = re.search(r"inet\s+([\d.]+)", line)
                        if ip_match:
                            current_ip = ip_match.group(1)
                    elif "ether " in line:
                        mac_match = re.search(r"ether\s+([\w:]+)", line)
                        if mac_match:
                            current_mac = mac_match.group(1)
                if current_iface and (current_ip or current_mac):
                    interfaces.append({
                        "name": current_iface,
                        "ip": current_ip or "",
                        "mac": current_mac or "",
                    })

    output["network"] = {"interfaces": interfaces}

# --- Uptime ---
if "uptime" in sections:
    uptime_info = {}

    if is_mac:
        # Get boot time
        boot_time_raw = run_cmd(["sysctl", "-n", "kern.boottime"])
        boot_match = re.search(r"sec\s*=\s*(\d+)", boot_time_raw)
        if boot_match:
            boot_ts = int(boot_match.group(1))
            uptime_secs = int(time.time()) - boot_ts
            import datetime
            boot_time = datetime.datetime.fromtimestamp(boot_ts).isoformat()
        else:
            uptime_secs = 0
            boot_time = ""
    elif is_linux:
        try:
            with open("/proc/uptime", "r") as f:
                uptime_secs = int(float(f.read().split()[0]))
        except Exception:
            uptime_secs = 0
        boot_ts = int(time.time()) - uptime_secs
        import datetime
        boot_time = datetime.datetime.fromtimestamp(boot_ts).isoformat()
    else:
        uptime_secs = 0
        boot_time = ""

    # Human-readable uptime
    days = uptime_secs // 86400
    hours = (uptime_secs % 86400) // 3600
    minutes = (uptime_secs % 3600) // 60
    parts = []
    if days > 0: parts.append(f"{days}d")
    if hours > 0: parts.append(f"{hours}h")
    parts.append(f"{minutes}m")
    uptime_human = " ".join(parts)

    uptime_info = {
        "uptime_seconds": uptime_secs,
        "uptime_human": uptime_human,
        "boot_time": boot_time,
    }
    output["uptime"] = uptime_info

# --- OS ---
if "os" in sections:
    os_info = {}
    os_info["hostname"] = platform.node()
    os_info["kernel"] = run_cmd(["uname", "-r"])

    if is_mac:
        os_info["name"] = "macOS"
        sw_vers = run_cmd(["sw_vers", "-productVersion"])
        os_info["version"] = sw_vers or platform.mac_ver()[0]
    elif is_linux:
        os_info["name"] = "Linux"
        # Try os-release
        version = ""
        try:
            with open("/etc/os-release", "r") as f:
                for line in f:
                    if line.startswith("PRETTY_NAME="):
                        version = line.split("=", 1)[1].strip().strip('"'"'"'"'"'")
                        break
        except Exception:
            version = platform.version()
        os_info["version"] = version
    else:
        os_info["name"] = platform.system()
        os_info["version"] = platform.version()

    output["os"] = os_info

print(json.dumps(output))
' <<< "$INPUT"
