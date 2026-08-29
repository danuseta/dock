# Electron Desktop Database

## Local Storage
- Uses `electron-store` (JSON file) for simple preferences.
- Uses `IndexedDB` or `SQLite` (via native module) if large local caching (e.g., offline mode) is required.

## Caching
- Apollo Client in-memory cache for GraphQL requests.