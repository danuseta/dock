# JIDIS Personal Command Center — Phase 0 and Phase 1

Status: Phase 0 and Phase 1 accepted locally on 2026-08-27.

## Scope

Phase 0 freezes the verified JIDIS behavior before runtime consolidation. Phase
1 turns the existing GraphQL BFF into the first modular-monolith shell: one Node
process serves GraphQL, health, and the built React SPA. Jira, GitHub, Discord,
storage, and PostgreSQL remain unchanged behind their current HTTP contracts.

## Explicit non-goals

- No Jira, GitHub, Discord, or storage module migration yet.
- No PostgreSQL-to-SQLite migration yet.
- No PIN/session security rewrite yet.
- No Home, Calendar, bookmark, or upstream-monitoring widget yet.
- No deployment or Tailscale cutover on `danuseta` yet.
- No removal of Electron or legacy Docker services.

## Phase 0 baseline

Verified on 2026-08-27:

- `npm run test:all`: 12 tests passed before Phase 0 changes.
- `npm run build --workspace=frontend`: passed.
- `npm run build --workspace=backend/bff-graphql`: passed.
- Root JIDIS contained no Beads database and no usable root Git history.
- Existing runtime boundary: React/Vite frontend, GraphQL BFF, Jira service,
  GitHub service, Discord service, storage service, and PostgreSQL.

Characterization guard:

- The public GraphQL Query and Mutation field sets are asserted explicitly.
- Existing resolver/domain tests remain authoritative for current behavior.

## Phase 1 target

```text
Browser
  `-- http://127.0.0.1:3000
       `-- JIDIS shell (one Node process)
            |-- React SPA static assets
            |-- /graphql
            `-- /health
                 |-- Jira service
                 |-- GitHub service
                 |-- Discord service
                 `-- storage service --> PostgreSQL
```

The shell is an intermediate strangler step. Later phases move one domain
module at a time into this process after contract parity. The legacy Compose
file stays untouched as the rollback path.

## Acceptance gates

1. Existing GraphQL contract characterization passes.
2. Direct requests to `/`, static assets, and SPA routes return the frontend.
3. `/graphql` remains functional and `/health` remains JSON.
4. Unknown `/api/*` paths are not swallowed by the SPA fallback.
5. Frontend and BFF production builds pass.
6. The combined production image builds from the repository root.
7. Existing `docker-compose.yml` remains available for rollback.

## Validation evidence

- `npm run test:all`: 17 tests passed after Phase 1 (8 BFF, 4 Jira, 5 storage).
- `npm run build:app`: frontend and BFF production builds passed.
- `docker compose -f docker-compose.monolith-shell.yml config`: passed with
  an explicit validation-only `ENCRYPTION_KEY`.
- `docker build -f backend/bff-graphql/Dockerfile.app -t jidis:phase1 .`:
  passed.
- Temporary `jidis:phase1` container health: `healthy`.
- Container `/health`: returned the existing JSON contract.
- Container `/work`: returned the React SPA entry point.
- Container `/graphql`: returned `{ "data": { "__typename": "Query" } }`.

## Operational notes

- The root `.env` still has no configured `ENCRYPTION_KEY`; full Compose startup
  remains fail-fast until the owner adds one. No secret was generated silently.
- Image build warnings show Apollo Server v4 is end-of-life and current npm
  dependency audit findings exist. This is tracked separately as `jidis-y9h` so
  a breaking dependency upgrade does not contaminate Phase 0–1.
- `docker-compose.yml` remains unchanged and is the legacy rollback topology.
- `docker-compose.monolith-shell.yml` is the opt-in Phase 1 topology.
