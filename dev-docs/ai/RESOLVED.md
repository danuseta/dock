# Resolved

This document stores notes on resolved issues and closed decisions.

## Architecture Decisions
- **Why GraphQL for BFF?**
  Jira and GitHub APIs return massive payloads. A BFF with GraphQL allows the React frontend to fetch exactly what it needs (e.g., ticket keys, PR statuses) without overloading the Electron IPC layer. Resolved during the spec phase.
- **Why Electron?**
  To avoid dealing with CORS from web browsers when communicating with local Discord apps, and to allow local file storage for credentials easily.
