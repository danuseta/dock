# JIDIS Personal Command Center — Phase 8

Status: accepted locally on 2026-08-27.

## Outcome

JIDIS now monitors user-managed HTTP(S) upstream targets from the existing
monolith. Target configuration and the latest probe result persist in SQLite.
The Monitoring page runs a check when opened, polls every 60 seconds, and
supports manual refresh, target creation, and target removal. Home exposes a
compact count of upstreams whose latest result is `DOWN`.

## Probe contract

- A target has a name, URL, expected HTTP status, and timeout.
- URLs must use HTTP or HTTPS and cannot contain embedded credentials.
- Timeouts are limited to 500–15,000 ms and the target count is capped at 20.
- Probes run in batches of five to protect the 2C/2G host from connection bursts.
- Redirects are not followed, response bodies are not consumed, and errors are
  truncated before persistence.
- Internal/private addresses are intentionally allowed because this personal
  dashboard is designed to monitor services on the owner's server. Monitor
  mutations and queries remain protected by the JIDIS PIN session boundary.
- A status is `UP` only when the returned status exactly matches the configured
  expected status; transport errors and mismatches are `DOWN`.

## Architecture decision

No scheduler, queue, monitoring microservice, or dependency was added. Probes
run on demand through GraphQL and from the page's 60-second polling interval.
This keeps the 2C/2G deployment at one `jidis-app` container and is sufficient
for a personal browser dashboard. Historical metrics and alert delivery are
outside Phase 8.

## Validation evidence

- `npm run build:app` passed for the frontend and BFF.
- Normal workspace run: 32 tests passed and one environment-gated SQLite test
  skipped.
- Real temporary SQLite run: all 24 BFF tests passed, including monitor result
  persistence.
- A real loopback HTTP server probe passed without reading the response body.
- Target Compose configuration still resolves to the single `jidis-app`
  service.

## Remaining boundary

- Phase 9 deploys the monolith through Tailscale and configures the browser
  start page.
- Alerts, uptime history, charts, and background checks are not implemented.
