#!/bin/sh
# Runs in the `offsite` container: copies new dumps to the rclone remote and prunes the remote copy.
# The remote is configured through RCLONE_CONFIG_<NAME>_* environment variables (docs/ops.md).
set -eu

: "${OFFSITE_REMOTE:?set OFFSITE_REMOTE, e.g. offsite:struja-backups}"
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-30}"

while true; do
  # Idempotent: files already on the remote are skipped, so running every six hours is cheap.
  if rclone copy /backups "$OFFSITE_REMOTE" --include "struja-*.dump" --max-age 3d; then
    rclone delete "$OFFSITE_REMOTE" --include "struja-*.dump" --min-age "${KEEP_DAYS}d" || true
    echo "off-site copy ok: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  else
    echo "off-site copy FAILED: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
  fi
  sleep 21600
done
