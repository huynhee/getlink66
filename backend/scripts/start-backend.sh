#!/bin/sh
set -eu

if [ "${THREED66_BROWSER_HEADLESS:-true}" != "false" ] || [ -n "${DISPLAY:-}" ]; then
  exec "$@"
fi

umask 077
export DISPLAY=:99
XAUTHORITY=$(mktemp /tmp/3dipl-xauth.XXXXXX)
export XAUTHORITY
cookie=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
xauth -f "$XAUTHORITY" add "$DISPLAY" . "$cookie"
Xvfb "$DISPLAY" -screen 0 1400x900x24 -nolisten tcp -auth "$XAUTHORITY" >/dev/null 2>&1 &
display_pid=$!

cleanup() {
  kill "$display_pid" 2>/dev/null || true
  wait "$display_pid" 2>/dev/null || true
  rm -f "$XAUTHORITY"
}

attempt=0
while [ ! -S /tmp/.X11-unix/X99 ]; do
  if ! kill -0 "$display_pid" 2>/dev/null || [ "$attempt" -ge 50 ]; then
    echo "Headed browser display could not start." >&2
    cleanup
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

"$@" &
app_pid=$!

# Let Node drain jobs and save browser state before stopping its display.
stop_app() {
  trap - TERM INT
  kill -TERM "$app_pid" 2>/dev/null || true
  set +e
  wait "$app_pid"
  result=$?
  cleanup
  exit "$result"
}
trap stop_app TERM INT
set +e
wait "$app_pid"
result=$?
cleanup
exit "$result"
