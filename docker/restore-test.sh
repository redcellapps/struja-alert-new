#!/bin/sh
# Restores the newest dump into a scratch database and compares row counts with the live one.
# Usage: sh docker/restore-test.sh "<docker compose command>"   (make restore-test does this)
set -eu

COMPOSE="${1:?pass the compose command}"
SCRATCH=struja_restore_test

latest=$($COMPOSE exec -T server sh -c 'ls -1t /backups/struja-*.dump | head -1')
[ -n "$latest" ] || { echo "no dump found in /backups" >&2; exit 1; }
echo "restoring $latest into $SCRATCH"

$COMPOSE exec -T db psql -U struja -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
$COMPOSE exec -T db psql -U struja -d "$SCRATCH" -c "CREATE EXTENSION IF NOT EXISTS postgis" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"
$COMPOSE exec -T server cat "$latest" | $COMPOSE exec -T db pg_restore -U struja -d "$SCRATCH" --no-owner --exit-on-error

count() {
  $COMPOSE exec -T db psql -U struja -d "$1" -At -c \
    "SELECT 'street=' || (SELECT count(*) FROM street) || ' outage=' || (SELECT count(*) FROM outage) || ' device=' || (SELECT count(*) FROM device) || ' subscription=' || (SELECT count(*) FROM subscription)"
}
restored=$(count "$SCRATCH")
live=$(count struja)
echo "restored: $restored"
echo "live:     $live"

$COMPOSE exec -T db psql -U struja -d postgres -c "DROP DATABASE $SCRATCH"
echo "restore test finished (counts of the dump can trail the live database by what happened since the dump)"
