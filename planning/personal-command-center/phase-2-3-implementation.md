# JIDIS Personal Command Center — Phase 2 and Phase 3

Status: Phase 2 and Phase 3 accepted locally on 2026-08-27.

## Scope delivered

### Phase 2 — backend PIN sessions

- Replaced browser-generated unlock tokens in `localStorage`/`sessionStorage`
  with opaque server-side sessions.
- Session identifiers are delivered only through `HttpOnly`, `SameSite=Strict`
  cookies; production cookies are also `Secure`.
- PIN verification is limited to five failures per client in a 15-minute
  window.
- Protected GraphQL queries and mutations fail with `UNAUTHENTICATED` while a
  master PIN is enabled and the session is locked.
- Changing or removing the PIN invalidates existing sessions.

Sessions intentionally remain in memory because the target is one private,
single-instance process. A restart locks the dashboard again.

### Phase 3 — monolith storage and SQLite

- The BFF now accesses storage directly instead of calling the legacy storage
  service over HTTP.
- The target Prisma schema uses SQLite and persists to `/app/data/jidis.db` in
  the container.
- Cache JSON is serialized explicitly because Prisma 5's SQLite connector does
  not expose the Prisma `Json` field type.
- Sensitive settings remain AES-256-GCM encrypted and require
  `ENCRYPTION_KEY`.
- New PIN hashes use salted scrypt; legacy SHA-256 PIN hashes remain readable.
- Jira and GitHub retain their existing cache contract through an internal
  compatibility router protected by a separate `INTERNAL_SERVICE_TOKEN`.
- The opt-in monolith Compose topology no longer includes PostgreSQL or the
  standalone storage container. The legacy Compose file remains unchanged.

## Validation evidence

- BFF suite: 11 passed, 1 environment-gated SQLite integration test skipped in
  the normal run.
- Full workspace test command: 20 tests passed, 1 environment-gated test
  skipped.
- SQLite integration run against a temporary real database: 1 passed.
- Frontend, BFF, Jira, and GitHub builds passed.
- `npm run build:app` passed.
- `docker compose -f docker-compose.monolith-shell.yml config -q` passed with
  validation-only secrets.
- Docker image `jidis:phase3` builds successfully after adding the Prisma
  runtime's OpenSSL requirement and a default SQLite URL.
- The production container reached `healthy`; health, SPA, GraphQL, internal
  storage authorization, physical SQLite creation, locked-dashboard rejection,
  and cookie-session unlock smoke checks passed.
- Docker Desktop's WSL engine was recovered by terminating only the
  `docker-desktop` distro and restarting Docker Desktop.

## Explicit non-goals

- Jira domain migration and Jira team/project filtering remain Phase 4.
- GitHub and Discord domain migration remain Phase 5.
- Home, Calendar, bookmarks, monitoring, Tailscale deployment, and server
  cutover remain later phases.
- The Electron wrapper and legacy Compose topology are not refactored here.
