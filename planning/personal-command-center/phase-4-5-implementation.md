# JIDIS Personal Command Center — Phase 4 and Phase 5

Status: Phase 4 and Phase 5 accepted locally on 2026-08-27.

## Scope delivered

### Phase 4 — Jira inside the monolith

- Jira Cloud calls now run directly inside the GraphQL BFF; the target runtime
  no longer makes HTTP calls to `jira-service`.
- Existing ticket shape, status grouping, sprint parsing, ADF description
  parsing, refresh behavior, and one-hour SQLite cache are preserved.
- Settings now expose a Jira project selector used as the stable team-workspace
  scope. Selected project keys are stored as `jiraProjectKeys` and added to the
  assigned-ticket JQL.
- Leaving the selector empty preserves the prior behavior: show every issue
  assigned to the authenticated Jira user.
- Jira project keys are normalized and validated before they enter JQL.

### Phase 5 — GitHub and Discord inside the monolith

- GitHub PR lookup, conflict checks, needs-attention lookup, repository listing,
  and SQLite-backed caches now run directly inside the BFF.
- Discord webhook validation, summary formatting, thread targeting, and bounded
  rate-limit retries now run directly inside the BFF.
- Public GraphQL shapes for tickets, pull requests, conflict details, needs
  attention, and Discord posting remain compatible.
- `docker-compose.monolith-shell.yml` now contains only `jidis-app`. The old
  multi-service `docker-compose.yml` remains untouched as a rollback path.
- The obsolete internal storage HTTP compatibility route was removed from the
  target app after all three integration consumers moved in-process.

## Validation evidence

- Backend TypeScript build passed.
- Frontend TypeScript and Vite production build passed.
- Workspace test run passed: 25 tests passed, with one environment-gated SQLite
  test skipped in the normal run.
- Target Compose resolves to exactly one service: `jidis-app`.
- No target BFF or target Compose references to the old Jira, GitHub, or Discord
  service URLs remain.

## Explicit non-goals

- Home/start page, Calendar, bookmark highlights, upstream monitoring,
  Tailscale/server deployment, and browser-default setup remain later phases.
- Legacy service folders and `docker-compose.yml` remain available for rollback.
- Live Jira, GitHub, and Discord credential smoke tests require the user's real
  encrypted settings and were not performed in automated tests.
