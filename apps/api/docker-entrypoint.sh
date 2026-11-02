#!/bin/sh
# Entry point for the Orbit API image.
#
#   api               serve the API (default)
#   migrate           apply database migrations to the configured database, then exit
#   worker [args...]  run the reminder worker (`orbit-worker`), for example `worker status`
#
# Anything else runs as a plain command. `exec` keeps the process as PID 1 so it receives
# SIGTERM from `docker stop` and shuts down cleanly.
set -eu

command="${1:-api}"
[ "$#" -gt 0 ] && shift

case "$command" in
  api)
    exec orbit-api "$@"
    ;;
  migrate)
    exec python -c 'from orbit_api.config import get_settings
from orbit_api.db.migrate import upgrade
upgrade(get_settings())
print("Database is at the latest schema revision.")'
    ;;
  worker)
    exec orbit-worker "$@"
    ;;
  *)
    exec "$command" "$@"
    ;;
esac
