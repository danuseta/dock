#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly BACKEND_DIR="$ROOT_DIR/backend/bff-graphql"
readonly FRONTEND_DIR="$ROOT_DIR/frontend"
readonly LOG_DIR="$ROOT_DIR/.dev/logs"
readonly BACKEND_PORT=4000
readonly FRONTEND_PORT=3000

pids=()
stopped=0

free_port() {
  local -r port="$1"
  local pid

  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    printf 'Stopping process on port %s (PID %s)...\n' "$port" "$pid"
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  done < <(netstat -ano -p tcp | awk -v port=":$port" '$2 ~ port && $4 == "LISTENING" { print $5 }' | sort -u)
}

shutdown() {
  [[ "$stopped" -eq 1 ]] && return
  stopped=1
  trap - EXIT INT TERM

  printf '\nStopping JIDIS...\n'
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
}

validate_runtime() {
  command -v npm >/dev/null 2>&1 || {
    printf 'ERROR: npm is not available in PATH.\n' >&2
    return 1
  }
  command -v taskkill >/dev/null 2>&1 || {
    printf 'ERROR: run this script from Git Bash on Windows.\n' >&2
    return 1
  }
  [[ -f "$BACKEND_DIR/package.json" && -f "$BACKEND_DIR/.env" ]] || {
    printf 'ERROR: backend package or .env is missing.\n' >&2
    return 1
  }
  [[ -f "$FRONTEND_DIR/package.json" ]] || {
    printf 'ERROR: frontend package is missing.\n' >&2
    return 1
  }
}

start_service() {
  local -r name="$1"
  local -r directory="$2"
  shift 2

  (
    cd "$directory"
    exec "$@"
  ) >"$LOG_DIR/$name.log" 2>&1 &

  pids+=("$!")
  printf 'Started %-8s PID %s\n' "$name" "$!"
}

main() {
  validate_runtime
  mkdir -p "$LOG_DIR"

  free_port "$BACKEND_PORT"
  free_port "$FRONTEND_PORT"

  trap shutdown EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  start_service backend "$BACKEND_DIR" env \
    PORT="$BACKEND_PORT" \
    CORS_ORIGIN="http://localhost:$FRONTEND_PORT" \
    npm run dev
  start_service frontend "$FRONTEND_DIR" env \
    VITE_GRAPHQL_URL="http://localhost:$BACKEND_PORT/graphql" \
    npm run dev -- --port "$FRONTEND_PORT" --strictPort

  cat <<EOF

JIDIS is running in this Git Bash session:
  Frontend  http://localhost:$FRONTEND_PORT
  Backend   http://localhost:$BACKEND_PORT/graphql
  Logs      $LOG_DIR

Press Ctrl+C to stop both processes.
EOF

  if ! wait -n "${pids[@]}"; then
    printf 'A JIDIS process stopped with an error. Check the logs above.\n' >&2
    return 1
  fi

  printf 'A JIDIS process stopped unexpectedly. Shutting down the other process.\n' >&2
  return 1
}

main "$@"
