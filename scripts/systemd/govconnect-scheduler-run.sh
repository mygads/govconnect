#!/usr/bin/env bash
#
# GovConnect ops scheduler helper — called by the systemd units in this
# directory (one unit per job). The repo cannot run its own cron, so these
# jobs are triggered externally; every job is idempotent and safe to re-run.
#
# Required env (via EnvironmentFile=/etc/govconnect/scheduler.env):
#   INTERNAL_API_KEY   internal API key of ai-service (x-internal-api-key)
#   AI_SERVICE_URL     e.g. http://127.0.0.1:3002
#   VILLAGE_IDS        space-separated village ids for per-village jobs
#
# Usage: govconnect-scheduler-run.sh <doc-sweep|kb-suggest|canary-rotate|lapor-drain>
set -u

API_KEY="${INTERNAL_API_KEY:?INTERNAL_API_KEY not set}"
BASE="${AI_SERVICE_URL:-http://127.0.0.1:3002}"
JOB="${1:?usage: $0 <doc-sweep|kb-suggest|canary-rotate|lapor-drain>}"

post() { # $1=url $2=json-body
  curl -fsS -m 60 -X POST "$1" \
    -H "Content-Type: application/json" \
    -H "x-internal-api-key: ${API_KEY}" \
    -d "$2"
}

case "$JOB" in
  doc-sweep)
    # R16: H+3 document reminders. Idempotent (one row per ticket).
    post "${BASE}/internal/reminders/doc-sweep" '{"limit":200}'
    ;;
  kb-suggest)
    # R5: KB improvement suggester, per village.
    for v in ${VILLAGE_IDS:-}; do
      echo "kb-suggest: village=${v}"
      post "${BASE}/api/kb-proposals/suggest" "{\"village_id\":\"${v}\",\"days\":7}"
      echo
    done
    ;;
  canary-rotate)
    # R6: plant a fresh canary honeytoken per village (old ones stay valid
    # tripwires; invalidate stale ones via the security API when rotating
    # them out).
    label="scheduled-$(date -u +%F)"
    for v in ${VILLAGE_IDS:-}; do
      echo "canary-rotate: village=${v} label=${label}"
      post "${BASE}/api/security/canary/plant" "{\"village_id\":\"${v}\",\"label\":\"${label}\"}"
      echo
    done
    ;;
  lapor-drain)
    # W17: drain the LAPOR! outbox (SKIP LOCKED claim — concurrent runs safe).
    post "${BASE}/internal/lapor/drain" '{"limit":25}'
    ;;
  *)
    echo "unknown job: ${JOB}" >&2
    exit 2
    ;;
esac
echo "job ${JOB} done"
