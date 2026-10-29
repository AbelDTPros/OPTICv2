#!/usr/bin/env bash
set -Eeuo pipefail

# Run this script from anywhere; it uses its own location as the repository root.
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$APP_DIR/var/run"
LOG_DIR="$APP_DIR/var/log"
mkdir -p "$RUN_DIR" "$LOG_DIR"

cd "$APP_DIR"

if [[ ! -f package.json || ! -f .env ]]; then
  echo "Missing package.json or .env in $APP_DIR" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1 || ! command -v setsid >/dev/null 2>&1; then
  echo "npm or setsid not found in PATH. Install Node.js/npm and util-linux." >&2
  exit 1
fi

is_running() {
  local file="$1" pid
  [[ -f "$file" ]] || return 1
  pid="$(cat "$file")"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

start_service() {
  local name="$1" script="$2" file="$RUN_DIR/$1.pid" logfile="$LOG_DIR/$1.log"
  if is_running "$file"; then
    echo "$name already running (PID $(cat "$file"))"
    return
  fi
  rm -f "$file"
  # 'exec' replaces the wrapper shell with npm so the PID can be tracked.
  nohup setsid bash -c 'cd "$1"; exec npm run "$2"' bash "$APP_DIR" "$script" >>"$logfile" 2>&1 </dev/null &
  local pid=$!
  echo "$pid" > "$file"
  sleep 2
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$name exited during startup. See $logfile" >&2
    rm -f "$file"
    return 1
  fi
  echo "Started $name (PID $pid): $logfile"
}

stop_service() {
  local name="$1" file="$RUN_DIR/$1.pid" pid
  if ! is_running "$file"; then
    echo "$name not running (or PID file stale)"
    rm -f "$file"
    return
  fi
  pid="$(cat "$file")"
  # setsid starts each service in its own process group.
  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  rm -f "$file"
  echo "Requested stop for $name (PID $pid)"
}

case "${1:-start}" in
  start)
    start_service api dev
    start_service web dev:web
    echo "API uses PORT from .env; frontend URL is printed in $LOG_DIR/web.log"
    ;;
  stop)
    stop_service web
    stop_service api
    ;;
  status)
    for name in api web; do
      if is_running "$RUN_DIR/$name.pid"; then
        echo "$name: running (PID $(cat "$RUN_DIR/$name.pid"))"
      else
        echo "$name: not running"
      fi
    done
    ;;
  logs)
    tail -n 80 -f "$LOG_DIR/api.log" "$LOG_DIR/web.log"
    ;;
  *)
    echo "Usage: $0 {start|stop|status|logs}" >&2
    exit 2
    ;;
esac
