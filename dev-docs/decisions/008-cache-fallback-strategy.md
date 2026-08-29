# ADR 008: Cache Fallback Strategy

## Status
Accepted

## Context
APIs fail. GitHub goes down, Jira goes down, or the user temporarily loses internet connection. A standard dashboard would render a blank screen or a massive error state.

## Decision
We will implement a Cache Fallback Strategy. The local PostgreSQL database is treated as a persistent cache. The UI always reads from the database. Background syncs update the database.

## Consequences
- **Positive:** The UI always loads instantly (Offline-First feel).
- **Positive:** If APIs are unreachable, the user can still see the last known state of their tickets.
- **Negative:** Data might occasionally be stale. The UI must clearly display a "Last Synced At" timestamp so the user knows if they are looking at cached data.
