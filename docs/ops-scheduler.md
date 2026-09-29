# Ops Scheduler — GovConnect background jobs

The repo cannot run its own cron (no in-process scheduler by design — see
`doc-reminders.ts` header). These four jobs are triggered externally via
systemd timers. Every job is idempotent and safe to re-run / overlap.

| Job | Timer | Endpoint | Notes |
|---|---|---|---|
| `doc-sweep` | hourly | `POST /internal/reminders/doc-sweep` | R16: H+3 document reminders; one row per ticket, at most once |
| `kb-suggest` | daily | `POST /api/kb-proposals/suggest` | R5: mines KB proposals per village (7-day window) |
| `canary-rotate` | daily | `POST /api/security/canary/plant` | R6: plants a fresh honeytoken per village; old tokens stay valid tripwires — invalidate stale ones via the security API when rotating out |
| `lapor-drain` | daily | `POST /internal/lapor/drain` | W17: drains the LAPOR! outbox (SKIP LOCKED claim, concurrent-safe); no-op unless `LAPOR_ENABLED=true` + API configured |

All endpoints require the `x-internal-api-key` header.

## Install (on the host that runs ai-service)

```bash
sudo mkdir -p /opt/govconnect/systemd /etc/govconnect
sudo cp scripts/systemd/govconnect-scheduler-run.sh /opt/govconnect/systemd/
sudo cp scripts/systemd/govconnect-*.service scripts/systemd/govconnect-*.timer /etc/systemd/system/
sudo cp scripts/systemd/scheduler.env.example /etc/govconnect/scheduler.env
sudo chmod 600 /etc/govconnect/scheduler.env
# edit /etc/govconnect/scheduler.env: INTERNAL_API_KEY, AI_SERVICE_URL, VILLAGE_IDS
sudo systemctl daemon-reload
sudo systemctl enable --now govconnect-doc-sweep.timer govconnect-kb-suggest.timer \
  govconnect-canary-rotate.timer govconnect-lapor-drain.timer
```

## Verify

```bash
systemctl list-timers 'govconnect-*'          # timers armed
journalctl -u govconnect-doc-sweep.service -n 20   # last run output
# manual trigger:
sudo systemctl start govconnect-lapor-drain.service
```

## Failure handling

- Units are `Type=oneshot`; a non-zero exit is visible in `journalctl` and
  `systemctl status`. Timers use `Persistent=true`, so a missed run (host
  down) fires once on the next boot instead of being silently skipped.
- If ai-service is unreachable, `curl -f` fails the unit — the next tick
  retries. No partial state: every endpoint is idempotent.
- Rotate `INTERNAL_API_KEY` in `/etc/govconnect/scheduler.env` whenever the
  ai-service key is rotated.
