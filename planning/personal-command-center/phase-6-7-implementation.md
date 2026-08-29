# JIDIS Personal Command Center — Phase 6 and Phase 7

Status: Phase 6 and Phase 7 accepted locally on 2026-08-27.

## Phase 6 — browser start Home

- `/` is now a personal Home page; the Jira board remains available at
  `/dashboard`.
- Home provides a live local clock, work counts, current Jira tickets, needs
  attention count, and the next calendar events.
- User-managed highlighted web links are stored in SQLite through additive
  GraphQL queries and mutations.
- Quick-link targets accept only `http://` or `https://` URLs.
- The sidebar no longer advertises obsolete microservice ports. It describes
  the actual monolith and SQLite runtime.

## Phase 7 — private Google Calendar

- Settings accept a Google OAuth Web client ID, encrypted client secret, and
  calendar ID (`primary` by default).
- OAuth runs through the monolith at `/auth/google/start` and
  `/auth/google/callback`; state values are random, one-time, and expire after
  ten minutes.
- Only the read-only Calendar scope is requested. The refresh token is stored
  encrypted; short-lived access tokens are refreshed and kept in memory only
  for the active request.
- Calendar events use `singleEvents=true` and `orderBy=startTime`, which expands
  recurring instances into the agenda view.
- Disconnect attempts Google token revocation and always removes the local
  refresh token.
- `PUBLIC_BASE_URL` defines the exact callback origin and avoids trusting a
  request Host header in the deployed runtime.

Google setup still requires the owner to enable Calendar API, create an OAuth
Web client, and register `<PUBLIC_BASE_URL>/auth/google/callback`.

Official references:

- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/calendar/api/v3/reference/events/list

## Validation evidence

- `npm run build:app` passed.
- Normal workspace run: 29 tests passed and one environment-gated SQLite test
  skipped.
- Real temporary SQLite run: all 21 BFF tests passed, including encrypted
  Google secret and persistent quick-link coverage.
- Target Compose configuration passed.
- Local one-process smoke passed for `/`, `/calendar`, GraphQL quick-link
  creation/readback, disconnected calendar fallback, and missing-OAuth-config
  redirect.
- Browser automation was unavailable because the local Playwright browser
  extension is not installed; HTTP, build, and API validation were used.

## Explicit non-goals

- Live Google authorization was not attempted without the owner's credentials.
- Monitoring/upstream health remains Phase 8.
- Tailscale exposure and server cutover remain Phase 9.
- The legacy rollback Compose file remains untouched.
