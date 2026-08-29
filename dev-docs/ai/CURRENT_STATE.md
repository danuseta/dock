# Current State

## Last Updated

2026-08-27

## Overview

JIDIS is an implemented personal Jira/GitHub workflow dashboard. Personal
Command Center Phases 0–7 are complete locally. The single runtime owns Jira,
GitHub, Discord, storage, highlighted links, and Google Calendar integration.

## Components Status

- **React/Vite frontend**: implemented; production build passes.
- **GraphQL BFF / monolith shell**: implemented; API, SPA, backend session, and
  rate-limit tests pass.
- **Jira/GitHub/Discord integrations**: execute directly inside the BFF.
- **Storage/SQLite**: consolidated into the monolith; real SQLite integration
  checks pass. Legacy PostgreSQL storage remains only in rollback Compose.
- **Electron wrapper**: retained, outside the current server-dashboard scope.
- **Personal Command Center widgets**: Home, clock, highlights, work summary,
  Calendar, and persistent HTTP(S) upstream monitoring are implemented.

## Validation

- 32 workspace tests pass; the SQLite integration also passes when enabled
  against a temporary real database.
- Frontend and BFF production builds pass.
- Phase 1 Docker image builds and reports healthy.
- SPA, GraphQL, and health smoke checks pass from the combined container.
- Phase 3 image reports healthy; SQLite creation, internal API authorization,
  locked access, and backend cookie-session unlock checks pass.

## Active Constraints

- Root `.env` needs an owner-provided `ENCRYPTION_KEY` before full Compose
  runtime can start. Calendar connection also needs owner-provided Google OAuth
  Web credentials and a registered callback based on `PUBLIC_BASE_URL`.
- Dependency modernization is tracked separately because Apollo Server v4 is
  end-of-life and current npm audits report findings.
