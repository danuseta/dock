# Monitoring and Observability

## JIDIS runtime health

The production topology is one `jidis-app` container backed by SQLite. Its
`GET /health` endpoint is used by Docker to verify that the Express runtime is
available. Application logs are written to stdout/stderr for Docker capture.

## Upstream monitoring

Phase 8 adds personal HTTP(S) upstream monitoring inside the monolith:

- Targets and latest results are stored in SQLite.
- The GraphQL `monitors` query reads results and can request a fresh probe.
- `checkMonitors` probes all configured targets; `addMonitor` and
  `removeMonitor` manage the target list.
- The frontend checks when the Monitoring page opens and every 60 seconds while
  it remains open. It also offers a manual refresh.
- A probe uses a bounded timeout, does not follow redirects, and does not read
  the response body. `UP` requires an exact expected-status match.

This is dashboard visibility, not an external alerting system. Checks stop when
the page is closed because Phase 8 intentionally adds no background scheduler.
Alert delivery and historical uptime metrics require a later phase.

## Security boundary

Monitoring is an authenticated owner feature. HTTP(S) targets may use private
or loopback addresses because monitoring server-local services is intentional.
Embedded URL credentials and non-HTTP protocols are rejected. Keep JIDIS behind
the PIN session and the private Tailscale boundary planned for Phase 9.
