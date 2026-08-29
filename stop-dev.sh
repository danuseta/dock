#!/usr/bin/env bash
set -Eeuo pipefail

readonly BACKEND_PORT=4000
readonly FRONTEND_PORT=3000

find_listener_pids() {
  local -r port="$1"
  netstat -ano -p tcp \
    | awk -v port="$port" '$4 == "LISTENING" && $2 ~ (":" port "$") { print $5 }' \
    | sort -u
}

stop_port() {
  local -r name="$1"
  local -r port="$2"
  local pid
  local stopped=0

  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    printf 'Stopping %-8s port %s (PID %s)...\n' "$name" "$port" "$pid"
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
    stopped=1
  done < <(find_listener_pids "$port")

  if [[ "$stopped" -eq 0 ]]; then
    printf '%-8s port %s is already free.\n' "$name" "$port"
  fi
}

verify_port() {
  local -r name="$1"
  local -r port="$2"
  local attempt

  for attempt in {1..20}; do
    [[ -z "$(find_listener_pids "$port")" ]] && return
    sleep 0.1
  done

  printf 'ERROR: %s is still listening on port %s.\n' "$name" "$port" >&2
  return 1
}

main() {
  command -v netstat >/dev/null 2>&1 || {
    printf 'ERROR: netstat is not available.\n' >&2
    return 1
  }
  command -v taskkill >/dev/null 2>&1 || {
    printf 'ERROR: run this script from Git Bash on Windows.\n' >&2
    return 1
  }

  stop_port backend "$BACKEND_PORT"
  stop_port frontend "$FRONTEND_PORT"

  verify_port backend "$BACKEND_PORT"
  verify_port frontend "$FRONTEND_PORT"
  printf 'JIDIS stopped. Ports %s and %s are free.\n' "$BACKEND_PORT" "$FRONTEND_PORT"
}

main "$@"
