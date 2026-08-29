# Changelog

All notable changes to the JIDIS project will be documented in this file.

## [Unreleased]
### Added
- Phase 2 Dev Docs AI initialization.
- Project spec translation into dev-docs/ai.
- GraphQL public-contract characterization coverage.
- Single-runtime JIDIS shell serving GraphQL, health, and the built React SPA.
- Combined production Docker image and opt-in monolith-shell Compose topology.
- Phase 0–1 implementation and rollback documentation.
- Server-side PIN sessions, secure cookies, and PIN-attempt rate limiting.
- SQLite schema and internal storage compatibility API.
- In-process Jira, GitHub, and Discord integrations.
- Browser-start Home, SQLite-backed highlighted links, and work summary.
- Read-only Google Calendar OAuth and agenda UI.
- Persistent HTTP(S) upstream monitoring with bounded probes and a dedicated UI.

### Changed
- BFF startup is now testable and uses the compiled production entrypoint.
- AI current-state and task documentation now reflects the implemented codebase.
- The monolith owns storage directly; the target Compose topology no longer
  runs PostgreSQL or a standalone storage container.
- New PIN hashes use salted scrypt while legacy hashes remain verifiable.
- Target Compose now runs only `jidis-app`; obsolete sidebar service ports were removed.
- Home now summarizes upstream failures from the latest persisted probe results.

### Fixed
- Direct SPA routes now fall back to `index.html` without masking GraphQL,
  health, or unknown API routes.
