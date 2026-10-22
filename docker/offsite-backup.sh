#!/bin/sh
# Runs in the `offsite` container: encrypts and copies new dumps to a private Backblaze B2 bucket
# through an rclone crypt remote, then prunes the remote copy. The remotes are built from the
# environment (compose.prod.yaml); the dumps are encrypted before they leave the machine.
set -eu

: "${B2_BUCKET:?set B2_BUCKET in docker/.env.prod}"
: "${B2_KEY_ID:?set B2_KEY_ID in docker/.env.prod}"
: "${B2_APP_KEY:?set B2_APP_KEY in docker/.env.prod}"
: "${CRYPT_PASSWORD:?set CRYPT_PASSWORD in docker/.env.prod}"
: "${CRYPT_SALT:?set CRYPT_SALT in docker/.env.prod}"
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-30}"

# rclone wants crypt passwords in its obscured form.
RCLONE_CONFIG_OFFSITE_PASSWORD="$(rclone obscure "$CRYPT_PASSWORD")"
RCLONE_CONFIG_OFFSITE_PASSWORD2="$(rclone obscure "$CRYPT_SALT")"
export RCLONE_CONFIG_OFFSITE_PASSWORD RCLONE_CONFIG_OFFSITE_PASSWORD2

while true; do
  # Idempotent: files already on the remote are skipped, so running every six hours is cheap.
  if rclone copy /backups offsite: --include "struja-*.dump" --max-age 3d; then
    # B2 hard delete is on, so pruned dumps are really gone, not kept as hidden versions.
    rclone delete offsite: --include "struja-*.dump" --min-age "${KEEP_DAYS}d" || true
    echo "off-site copy ok: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  else
    echo "off-site copy FAILED: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
  fi
  sleep 21600
done
