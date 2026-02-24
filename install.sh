#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# ScalyClaw — One-command installer / manager
#
# Usage:
#   curl -fsSL https://scalyclaw.netlify.app/install.sh | sh
#   ~/.scalyclaw/scalyclaw.sh --stop                               # stop all
#   ~/.scalyclaw/scalyclaw.sh --start                              # start all
#   ~/.scalyclaw/scalyclaw.sh --status                             # show status
#   ~/.scalyclaw/scalyclaw.sh --uninstall                          # remove all
# ─────────────────────────────────────────────────────────────────────────────

SCALYCLAW_HOME="$HOME/.scalyclaw"
SCALYCLAW_REPO="$SCALYCLAW_HOME/repo"
SCALYCLAW_CONFIG="$SCALYCLAW_HOME/scalyclaw.json"
REDIS_DIR="$SCALYCLAW_HOME/redis"
REDIS_DATA="$SCALYCLAW_HOME/redis-data"
REDIS_PORT=6379
WORKER_NAMES=("alpha" "bravo" "charlie")
DASHBOARD_PORT=4173
GATEWAY_PORT=3000

# ─── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()    { printf "${CYAN}▸${NC} %s\n" "$1"; }
success() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()    { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
error()   { printf "${RED}✗${NC} %s\n" "$1"; }
header()  { printf "\n${BOLD}${CYAN}─── %s ───${NC}\n\n" "$1"; }

# ─── Helpers ─────────────────────────────────────────────────────────────────

command_exists() { command -v "$1" &>/dev/null; }

# Resolve redis-cli — prefer our local install
redis_cli() {
  if [ -x "$REDIS_DIR/bin/redis-cli" ]; then
    "$REDIS_DIR/bin/redis-cli" -p "$REDIS_PORT" "$@"
  elif command_exists redis-cli; then
    redis-cli -p "$REDIS_PORT" "$@"
  else
    error "redis-cli not found"
    return 1
  fi
}

redis_server_bin() {
  if [ -x "$REDIS_DIR/bin/redis-server" ]; then
    echo "$REDIS_DIR/bin/redis-server"
  elif command_exists redis-server; then
    command -v redis-server
  else
    echo ""
  fi
}

redis_is_running() {
  redis_cli ping &>/dev/null 2>&1
}

# CLI entry point
scalyclaw_cli() {
  cd "$SCALYCLAW_REPO"
  bun "$SCALYCLAW_REPO/cli/src/cli.ts" "$@"
}

# Extract dashboard token URL from log file (polls for up to 8s)
get_dashboard_url() {
  local log_file="$SCALYCLAW_HOME/logs/scalyclaw-dashboard.log"
  local deadline=$((SECONDS + 8))
  while [ $SECONDS -lt $deadline ]; do
    if [ -f "$log_file" ]; then
      local url
      url=$(grep -oE 'http://localhost:[0-9]+\?token=[^ ]+' "$log_file" 2>/dev/null | tail -1 || true)
      if [ -n "$url" ]; then
        echo "$url"
        return 0
      fi
    fi
    sleep 0.5
  done
  echo ""
}

# Print access info (dashboard URL + SSH tunnel)
print_access_info() {
  local dashboard_url="$1"
  local is_final="${2:-false}"

  echo ""
  if [ -n "$dashboard_url" ]; then
    printf "  ${BOLD}Dashboard:${NC}  ${CYAN}%s${NC}\n" "$dashboard_url"
  else
    printf "  ${BOLD}Dashboard:${NC}  http://localhost:%s ${DIM}(token in log: %s/logs/scalyclaw-dashboard.log)${NC}\n" "$DASHBOARD_PORT" "$SCALYCLAW_HOME"
  fi
  printf "  ${BOLD}Node API:${NC}   http://localhost:%s\n" "$GATEWAY_PORT"
  printf "  ${BOLD}Workers:${NC}    %s (ports 3001-%s)\n" "${WORKER_NAMES[*]}" "$((3000 + ${#WORKER_NAMES[@]}))"
  printf "  ${BOLD}Logs:${NC}       %s/logs/\n" "$SCALYCLAW_HOME"
  echo ""

  # SSH tunnel hints (useful on servers)
  printf "  ${DIM}Remote access (SSH tunnel):${NC}\n"
  printf "  ${DIM}  Dashboard:  ssh -N -L %s:127.0.0.1:%s user@<server_ip>${NC}\n" "$DASHBOARD_PORT" "$DASHBOARD_PORT"
  printf "  ${DIM}  Gateway:    ssh -N -L %s:127.0.0.1:%s user@<server_ip>${NC}\n" "$GATEWAY_PORT" "$GATEWAY_PORT"
  echo ""

  if [ "$is_final" = "true" ]; then
    printf "  ${DIM}Manage ScalyClaw:${NC}\n"
    printf "    ${DIM}Stop:       %s/scalyclaw.sh --stop${NC}\n" "$SCALYCLAW_HOME"
    printf "    ${DIM}Start:      %s/scalyclaw.sh --start${NC}\n" "$SCALYCLAW_HOME"
    printf "    ${DIM}Status:     %s/scalyclaw.sh --status${NC}\n" "$SCALYCLAW_HOME"
    printf "    ${DIM}Uninstall:  %s/scalyclaw.sh --uninstall${NC}\n" "$SCALYCLAW_HOME"
    echo ""
  fi
}

# ─── Redis (user-local) ─────────────────────────────────────────────────────

install_redis() {
  header "Installing Redis (user-local)"

  # If something is on our port but doesn't respond to unauthenticated PING, stop it
  # (e.g. a Redis with requirepass — we need a no-auth instance)
  if ! redis_is_running && nc -z 127.0.0.1 "$REDIS_PORT" 2>/dev/null; then
    warn "Redis on port $REDIS_PORT requires auth — restarting with no-auth config..."
    local old_pid
    old_pid=$(redis_cli SHUTDOWN NOSAVE 2>/dev/null || true)
    # If shutdown failed (auth required), try the pid file or lsof
    if nc -z 127.0.0.1 "$REDIS_PORT" 2>/dev/null; then
      if [ -f "$SCALYCLAW_HOME/redis.pid" ]; then
        kill "$(cat "$SCALYCLAW_HOME/redis.pid" 2>/dev/null)" 2>/dev/null || true
      fi
      sleep 1
    fi
  fi

  # Already have a working no-auth redis?
  local existing_bin
  existing_bin=$(redis_server_bin)
  if [ -n "$existing_bin" ] && redis_is_running; then
    success "Redis is already running ($(redis_cli INFO server 2>/dev/null | grep redis_version | tr -d '\r' || echo 'unknown version'))"
    return 0
  fi

  # If binary exists but not running, just start it
  if [ -n "$existing_bin" ]; then
    info "Redis binary found at $existing_bin — starting..."
    start_redis
    return 0
  fi

  # Build from source — no root required
  info "Building Redis from source (no root needed)..."

  local build_dir
  build_dir=$(mktemp -d)
  trap "rm -rf '$build_dir'" RETURN

  # Check for make and cc
  if ! command_exists make; then
    error "make is required to build Redis."
    echo "  Install build tools:"
    printf "    ${BOLD}macOS:${NC}  xcode-select --install\n"
    printf "    ${BOLD}Ubuntu:${NC} sudo apt install build-essential\n"
    printf "    ${BOLD}Arch:${NC}   sudo pacman -S base-devel\n"
    exit 1
  fi

  cd "$build_dir"
  info "Downloading Redis 7.4.3..."
  curl -fsSL "https://github.com/redis/redis/archive/7.4.3.tar.gz" -o redis.tar.gz
  tar xzf redis.tar.gz
  cd redis-7.4.3

  info "Compiling (this may take a minute)..."
  make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)" PREFIX="$REDIS_DIR" BUILD_TLS=no &>/dev/null

  info "Installing to $REDIS_DIR..."
  make PREFIX="$REDIS_DIR" install &>/dev/null

  cd "$HOME"
  success "Redis installed to $REDIS_DIR/bin/"

  # Start it
  start_redis
}

start_redis() {
  local server_bin
  server_bin=$(redis_server_bin)
  if [ -z "$server_bin" ]; then
    error "redis-server not found"
    exit 1
  fi

  if redis_is_running; then
    success "Redis is already running on port $REDIS_PORT"
    return 0
  fi

  mkdir -p "$REDIS_DATA" "$SCALYCLAW_HOME/logs"

  # Write minimal config — no auth, localhost only
  cat > "$SCALYCLAW_HOME/redis.conf" << REOF
port $REDIS_PORT
bind 127.0.0.1
protected-mode no
daemonize yes
pidfile $SCALYCLAW_HOME/redis.pid
logfile $SCALYCLAW_HOME/logs/redis.log
dir $REDIS_DATA
dbfilename dump.rdb
appendonly yes
appendfilename "appendonly.aof"
maxmemory 256mb
maxmemory-policy allkeys-lru
REOF

  info "Starting Redis on port $REDIS_PORT..."
  "$server_bin" "$SCALYCLAW_HOME/redis.conf"

  # Wait for Redis to be ready
  local attempts=0
  while [ $attempts -lt 10 ]; do
    if redis_is_running; then
      success "Redis is running on port $REDIS_PORT"
      return 0
    fi
    sleep 0.5
    attempts=$((attempts + 1))
  done

  error "Redis failed to start. Check $SCALYCLAW_HOME/logs/redis.log"
  exit 1
}

stop_redis() {
  if redis_is_running; then
    info "Stopping Redis..."
    redis_cli shutdown nosave &>/dev/null 2>&1 || true
    sleep 1
    if ! redis_is_running; then
      success "Redis stopped"
    else
      warn "Redis may still be running"
    fi
  fi
}

# ─── Stop ────────────────────────────────────────────────────────────────────

do_stop() {
  header "Stopping ScalyClaw"

  if [ ! -f "$SCALYCLAW_CONFIG" ]; then
    error "ScalyClaw is not installed (no config at $SCALYCLAW_CONFIG)"
    exit 1
  fi

  export PATH="$REDIS_DIR/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

  # Graceful stop
  info "Stopping dashboard..."
  scalyclaw_cli dashboard stop 2>/dev/null || true
  for name in "${WORKER_NAMES[@]}"; do
    info "Stopping worker $name..."
    scalyclaw_cli worker stop --name "$name" 2>/dev/null || true
  done
  info "Stopping node..."
  scalyclaw_cli node stop 2>/dev/null || true

  sleep 2

  # Force kill anything still alive
  info "Force-killing any remaining processes..."
  force_kill_port "$DASHBOARD_PORT"
  force_kill_port "$GATEWAY_PORT"
  local base_worker_port=3001
  local i=0
  for name in "${WORKER_NAMES[@]}"; do
    force_kill_port $((base_worker_port + i))
    i=$((i + 1))
  done

  # Stop our Redis (only if we manage it)
  if [ -f "$SCALYCLAW_HOME/redis.conf" ]; then
    stop_redis
  fi

  success "All ScalyClaw processes stopped"
}

# ─── Start ───────────────────────────────────────────────────────────────────

do_start() {
  header "Starting ScalyClaw"

  if [ ! -f "$SCALYCLAW_CONFIG" ]; then
    error "ScalyClaw is not installed (no config at $SCALYCLAW_CONFIG)"
    exit 1
  fi

  # Ensure PATH includes our tools
  export PATH="$REDIS_DIR/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

  # Start Redis if we manage it
  if [ -f "$SCALYCLAW_HOME/redis.conf" ]; then
    start_redis
  elif ! redis_is_running; then
    error "Redis is not running. Start Redis manually or re-install ScalyClaw."
    exit 1
  fi

  # Start node in background
  info "Starting node..."
  scalyclaw_cli node background

  # Wait for node to be ready
  local attempts=0
  while [ $attempts -lt 15 ]; do
    if curl -sf "http://localhost:$GATEWAY_PORT/health" &>/dev/null; then
      break
    fi
    sleep 1
    attempts=$((attempts + 1))
  done

  if curl -sf "http://localhost:$GATEWAY_PORT/health" &>/dev/null; then
    success "Node is running on port $GATEWAY_PORT"
  else
    warn "Node may still be starting (check $SCALYCLAW_HOME/logs/scalyclaw-node.log)"
  fi

  # Start workers in background
  for name in "${WORKER_NAMES[@]}"; do
    local worker_config="$HOME/.scalyclaw-worker-${name}/worker.json"
    if [ -f "$worker_config" ]; then
      info "Starting worker $name..."
      scalyclaw_cli worker background --name "$name"
    else
      warn "Worker $name config not found — skipping"
    fi
  done

  # Start dashboard in background
  info "Starting dashboard..."
  scalyclaw_cli dashboard background --port "$DASHBOARD_PORT" --gateway "http://localhost:$GATEWAY_PORT"

  # Get dashboard token URL
  local dashboard_url
  dashboard_url=$(get_dashboard_url)

  echo ""
  success "ScalyClaw is running!"
  print_access_info "$dashboard_url"
}

# ─── Uninstall ───────────────────────────────────────────────────────────────

force_kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    for pid in $pids; do
      info "Killing process $pid on port $port..."
      kill -9 "$pid" 2>/dev/null || true
    done
  fi
}

force_kill_pid_file() {
  local pidfile="$1"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      info "Killing process $pid (from $pidfile)..."
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
}

do_uninstall() {
  header "Uninstalling ScalyClaw"

  printf "${YELLOW}This will remove EVERYTHING:${NC}\n"
  echo "  - Stop all processes (node, workers, dashboard, Redis)"
  echo "  - Remove Redis (binaries, data, and all stored keys)"
  echo "  - Remove $SCALYCLAW_HOME (repo, config, database, mind, logs)"
  echo "  - Remove worker directories (~/.scalyclaw-worker-*)"
  echo ""
  printf "  ${DIM}bun and uv will NOT be removed.${NC}\n"
  echo ""

  read -rp "Are you sure? [y/N] " confirm < /dev/tty
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    info "Uninstall cancelled."
    exit 0
  fi

  # Ensure PATH
  export PATH="$REDIS_DIR/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

  # ── Graceful stop (best effort) ──────────────────────────────────
  if [ -f "$SCALYCLAW_CONFIG" ] && [ -d "$SCALYCLAW_REPO" ]; then
    info "Stopping all processes (graceful)..."
    scalyclaw_cli dashboard stop 2>/dev/null || true
    for name in "${WORKER_NAMES[@]}"; do
      scalyclaw_cli worker stop --name "$name" 2>/dev/null || true
    done
    scalyclaw_cli node stop 2>/dev/null || true
    sleep 2
  fi

  # ── Flush Redis before killing ───────────────────────────────────
  if redis_is_running; then
    info "Flushing all Redis data..."
    redis_cli FLUSHALL &>/dev/null 2>&1 || true
    success "Redis data flushed"
    redis_cli shutdown nosave &>/dev/null 2>&1 || true
    sleep 1
  fi

  # ── Force kill anything still alive ──────────────────────────────
  info "Force-killing any remaining processes..."

  # Kill by known ports
  force_kill_port "$DASHBOARD_PORT"
  force_kill_port "$GATEWAY_PORT"
  local base_worker_port=3001
  local i=0
  for name in "${WORKER_NAMES[@]}"; do
    force_kill_port $((base_worker_port + i))
    i=$((i + 1))
  done
  force_kill_port "$REDIS_PORT"

  # Kill by pid files
  force_kill_pid_file "$SCALYCLAW_HOME/redis.pid"
  for pidfile in "$SCALYCLAW_HOME"/logs/*.pid; do
    force_kill_pid_file "$pidfile" 2>/dev/null || true
  done
  for name in "${WORKER_NAMES[@]}"; do
    for pidfile in "$HOME/.scalyclaw-worker-${name}"/logs/*.pid; do
      force_kill_pid_file "$pidfile" 2>/dev/null || true
    done
  done

  sleep 1

  # ── Verify all ports are free ────────────────────────────────────
  local all_clear=true
  for port in "$DASHBOARD_PORT" "$GATEWAY_PORT" "$REDIS_PORT"; do
    if lsof -ti :"$port" &>/dev/null; then
      warn "Port $port is still in use"
      all_clear=false
    fi
  done

  if [ "$all_clear" = true ]; then
    success "All ports cleared"
  else
    warn "Some ports may still be in use — proceeding with cleanup"
  fi

  # ── Remove files ─────────────────────────────────────────────────
  info "Removing worker directories..."
  rm -rf "$HOME"/.scalyclaw-worker-*

  info "Removing $SCALYCLAW_HOME..."
  rm -rf "$SCALYCLAW_HOME"

  success "ScalyClaw has been completely uninstalled"
  echo ""
  printf "  ${DIM}bun and uv were NOT removed.${NC}\n"
  printf "  ${DIM}To remove bun:  rm -rf ~/.bun${NC}\n"
  printf "  ${DIM}To remove uv:   rm -rf ~/.local/bin/uv ~/.local/bin/uvx${NC}\n"
  echo ""
}

# ─── Status ──────────────────────────────────────────────────────────────────

do_status() {
  if [ ! -f "$SCALYCLAW_CONFIG" ] || [ ! -d "$SCALYCLAW_REPO" ]; then
    error "ScalyClaw is not installed."
    exit 1
  fi

  export PATH="$REDIS_DIR/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

  header "ScalyClaw Status"

  # Redis
  if redis_is_running; then
    local redis_info
    redis_info=$(redis_cli INFO server 2>/dev/null | grep redis_version | tr -d '\r' || echo "")
    printf "  ${GREEN}●${NC} Redis     ${GREEN}running${NC}  (port %s" "$REDIS_PORT"
    if [ -n "$redis_info" ]; then
      printf ", %s" "$redis_info"
    fi
    echo ")"
  else
    printf "  ${RED}●${NC} Redis     ${RED}stopped${NC}\n"
  fi
  echo ""

  # Node / Worker / Dashboard
  scalyclaw_cli node status 2>/dev/null || printf "  ${RED}●${NC} Node      ${RED}stopped${NC}\n"
  scalyclaw_cli worker status 2>/dev/null || true
  scalyclaw_cli dashboard status 2>/dev/null || printf "  ${RED}●${NC} Dashboard ${RED}stopped${NC}\n"
}

# ─── Install ─────────────────────────────────────────────────────────────────

do_install() {
  echo ""
  printf "${BOLD}${CYAN}"
  cat << 'LOGO'
   ____            _        ____ _
  / ___|  ___ __ _| |_   _ / ___| | __ ___      __
  \___ \ / __/ _` | | | | | |   | |/ _` \ \ /\ / /
   ___) | (_| (_| | | |_| | |___| | (_| |\ V  V /
  |____/ \___\__,_|_|\__, |\____|_|\__,_| \_/\_/
                     |___/
LOGO
  printf "${NC}\n"
  printf "  ${DIM}The AI That Scales With You.${NC}\n\n"

  # ── Detect existing installation ─────────────────────────────────
  if [ -f "$SCALYCLAW_CONFIG" ] || [ -d "$SCALYCLAW_REPO/.git" ]; then
    warn "Existing ScalyClaw installation detected."
    echo ""
    # read from /dev/tty so it works even when piped (curl | sh)
    read -rp "  Overwrite and start fresh? [y/N] " confirm < /dev/tty
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      info "Installation cancelled."
      exit 0
    fi

    echo ""
    export PATH="$REDIS_DIR/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

    # Graceful stop
    info "Stopping all running processes..."
    if [ -d "$SCALYCLAW_REPO" ] && command_exists bun; then
      scalyclaw_cli dashboard stop 2>/dev/null || true
      for name in "${WORKER_NAMES[@]}"; do
        scalyclaw_cli worker stop --name "$name" 2>/dev/null || true
      done
      scalyclaw_cli node stop 2>/dev/null || true
    fi
    sleep 2

    # Force kill by ports
    force_kill_port "$DASHBOARD_PORT"
    force_kill_port "$GATEWAY_PORT"
    local base_port=3001
    local idx=0
    for name in "${WORKER_NAMES[@]}"; do
      force_kill_port $((base_port + idx))
      idx=$((idx + 1))
    done

    # Flush and stop Redis
    if redis_is_running; then
      redis_cli FLUSHALL &>/dev/null 2>&1 || true
      redis_cli shutdown nosave &>/dev/null 2>&1 || true
      sleep 1
    fi
    force_kill_port "$REDIS_PORT"

    # Remove old files
    info "Removing old installation..."
    rm -rf "$SCALYCLAW_HOME"
    rm -rf "$HOME"/.scalyclaw-worker-*

    success "Old installation removed"
    echo ""
  fi

  mkdir -p "$SCALYCLAW_HOME"

  # ── Install Bun ────────────────────────────────────────────────────

  header "Installing Prerequisites"

  if command_exists bun; then
    success "Bun is installed (v$(bun --version 2>/dev/null || echo '?'))"
  else
    info "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    if command_exists bun; then
      success "Bun installed (v$(bun --version))"
    else
      error "Bun installation failed. Install manually: https://bun.sh"
      exit 1
    fi
  fi

  # ── Install uv ────────────────────────────────────────────────────

  if command_exists uv; then
    success "uv is installed ($(uv --version 2>/dev/null | head -1 || echo '?'))"
  else
    info "Installing uv (Python package manager)..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
    if command_exists uv; then
      success "uv installed ($(uv --version | head -1))"
    else
      error "uv installation failed. Install manually: https://docs.astral.sh/uv/"
      exit 1
    fi
  fi

  # ── Install Rust ─────────────────────────────────────────────────

  if command_exists cargo; then
    success "Rust is installed ($(rustc --version 2>/dev/null | head -1 || echo '?'))"
  else
    info "Installing Rust (needed for Rust skills)..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --quiet
    export PATH="$HOME/.cargo/bin:$PATH"
    if command_exists cargo; then
      success "Rust installed ($(rustc --version | head -1))"
    else
      error "Rust installation failed. Install manually: https://rustup.rs"
      exit 1
    fi
  fi

  # ── Install / Start Redis ─────────────────────────────────────────

  export PATH="$REDIS_DIR/bin:$PATH"
  install_redis

  # ── Clone / Update Repo ───────────────────────────────────────────

  header "Installing ScalyClaw"

  if [ -d "$SCALYCLAW_REPO/.git" ]; then
    info "Updating existing installation..."
    cd "$SCALYCLAW_REPO"
    git pull --ff-only 2>/dev/null || {
      warn "Could not fast-forward — using existing version"
    }
  else
    if [ -d "$SCALYCLAW_REPO" ]; then
      rm -rf "$SCALYCLAW_REPO"
    fi
    info "Cloning ScalyClaw..."
    git clone https://github.com/scalyclaw/scalyclaw.git "$SCALYCLAW_REPO"
    cd "$SCALYCLAW_REPO"
  fi

  # ── Install Dependencies & Build ──────────────────────────────────

  info "Installing dependencies..."
  bun install

  info "Building packages..."
  bun run build

  # ── Write Setup Config (scalyclaw.json) ───────────────────────────

  header "Configuring ScalyClaw"

  if [ -f "$SCALYCLAW_CONFIG" ]; then
    info "Setup config already exists at $SCALYCLAW_CONFIG (keeping)"
  else
    info "Writing default setup config..."
    cat > "$SCALYCLAW_CONFIG" << CEOF
{
  "homeDir": "~/.scalyclaw",
  "redis": {
    "host": "localhost",
    "port": $REDIS_PORT,
    "password": null,
    "tls": false
  }
}
CEOF
    chmod 600 "$SCALYCLAW_CONFIG"
    success "Config written to $SCALYCLAW_CONFIG"
  fi

  # ── Create Home Directories ───────────────────────────────────────

  info "Creating directory structure..."
  mkdir -p "$SCALYCLAW_HOME"/{workspace,logs,skills,agents,mind,database}

  # Copy default mind files from repo
  if [ -d "$SCALYCLAW_REPO/mind" ]; then
    cp -n "$SCALYCLAW_REPO/mind/"*.md "$SCALYCLAW_HOME/mind/" 2>/dev/null || true
  fi

  success "Directories created"

  # ── Seed Default Config in Redis ──────────────────────────────────

  info "Seeding default config in Redis..."

  local existing
  existing=$(redis_cli EXISTS scalyclaw:config 2>/dev/null | tr -d '[:space:]' || echo "0")
  if [ "$existing" = "1" ] || [ "$existing" = "(integer)1" ]; then
    info "Existing config found in Redis (keeping)"
  else
    cd "$SCALYCLAW_REPO"
    bun -e "
      const { CONFIG_DEFAULTS } = await import('./scalyclaw/src/core/config.ts');
      const { Redis } = await import('ioredis');
      const redis = new Redis({ host: 'localhost', port: $REDIS_PORT, lazyConnect: true });
      await redis.connect();
      await redis.set('scalyclaw:config', JSON.stringify(CONFIG_DEFAULTS, null, 2));
      redis.disconnect();
    "
    success "Default config seeded in Redis"
  fi

  # ── Write Worker Configs ──────────────────────────────────────────

  info "Setting up workers..."

  local base_worker_port=3001
  local i=0
  for name in "${WORKER_NAMES[@]}"; do
    local worker_dir="$HOME/.scalyclaw-worker-${name}"
    local worker_config="$worker_dir/worker.json"
    local worker_port=$((base_worker_port + i))

    if [ -f "$worker_config" ]; then
      info "Worker $name config already exists (keeping)"
    else
      mkdir -p "$worker_dir"/{logs,workspace}
      cat > "$worker_config" << WEOF
{
  "homeDir": "~/.scalyclaw-worker-${name}",
  "gateway": {
    "host": "127.0.0.1",
    "port": ${worker_port},
    "tls": false,
    "authToken": null
  },
  "redis": {
    "host": "localhost",
    "port": $REDIS_PORT,
    "password": null,
    "tls": false
  },
  "node": {
    "url": "http://localhost:${GATEWAY_PORT}",
    "token": ""
  },
  "concurrency": 3
}
WEOF
      chmod 600 "$worker_config"
      success "Worker $name configured (port $worker_port)"
    fi

    i=$((i + 1))
  done

  # ── Start Everything ──────────────────────────────────────────────

  header "Starting ScalyClaw"

  # Start node in background
  info "Starting node..."
  scalyclaw_cli node background

  # Wait for node to be ready
  info "Waiting for node to be ready..."
  local attempts=0
  while [ $attempts -lt 20 ]; do
    if curl -sf "http://localhost:$GATEWAY_PORT/health" &>/dev/null; then
      break
    fi
    sleep 1
    attempts=$((attempts + 1))
  done

  if curl -sf "http://localhost:$GATEWAY_PORT/health" &>/dev/null; then
    success "Node is running on port $GATEWAY_PORT"
  else
    warn "Node may still be starting (check $SCALYCLAW_HOME/logs/scalyclaw-node.log)"
  fi

  # Start workers in background
  for name in "${WORKER_NAMES[@]}"; do
    info "Starting worker $name..."
    scalyclaw_cli worker background --name "$name"
    sleep 1
  done

  # Start dashboard in background
  info "Starting dashboard..."
  scalyclaw_cli dashboard background --port "$DASHBOARD_PORT" --gateway "http://localhost:$GATEWAY_PORT"

  # ── Done ──────────────────────────────────────────────────────────

  local dashboard_url
  dashboard_url=$(get_dashboard_url)

  echo ""
  printf "${BOLD}${GREEN}"
  echo "  ╔═══════════════════════════════════════════╗"
  echo "  ║     ScalyClaw installed successfully!     ║"
  echo "  ╚═══════════════════════════════════════════╝"
  printf "${NC}"

  print_access_info "$dashboard_url" "true"

  # Copy this script for management commands (--stop, --start, etc.)
  copy_self
}

# ─── Main ────────────────────────────────────────────────────────────────────

# Copy this script into SCALYCLAW_HOME for management commands
copy_self() {
  local dest="$SCALYCLAW_HOME/scalyclaw.sh"
  mkdir -p "$SCALYCLAW_HOME"

  # If running from a file (./install.sh), copy it
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    local self="${BASH_SOURCE[0]}"
    if [ "$(realpath "$self" 2>/dev/null || echo "$self")" != "$(realpath "$dest" 2>/dev/null || echo "$dest")" ]; then
      cp "$self" "$dest"
      chmod +x "$dest"
      return 0
    fi
  fi

  # If running from pipe (curl | sh), copy from the cloned repo
  if [ -f "$SCALYCLAW_REPO/install.sh" ]; then
    cp "$SCALYCLAW_REPO/install.sh" "$dest"
    chmod +x "$dest"
  fi
}

case "${1:-}" in
  --stop)
    do_stop
    ;;
  --start)
    do_start
    ;;
  --uninstall)
    do_uninstall
    ;;
  --status)
    do_status
    ;;
  --help|-h)
    echo ""
    echo "ScalyClaw Installer & Manager"
    echo ""
    echo "Usage:"
    echo "  install.sh              Install everything and start all processes"
    echo "  scalyclaw.sh --start    Start all processes (Redis, node, workers, dashboard)"
    echo "  scalyclaw.sh --stop     Stop all processes"
    echo "  scalyclaw.sh --status   Show status of all processes"
    echo "  scalyclaw.sh --uninstall  Remove ScalyClaw completely and clear Redis data"
    echo ""
    ;;
  "")
    do_install
    copy_self
    ;;
  *)
    error "Unknown option: $1"
    echo "Run with --help for usage."
    exit 1
    ;;
esac
