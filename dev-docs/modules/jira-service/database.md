# Jira Service Database

## Schema
- `jira_issues`: Cache of recently accessed or synced issues.
- `jira_webhooks_log`: Audit log of received webhooks.
- `jira_sync_state`: Tracks the last synced timestamp for polling fallbacks.

## Caching
- Frequently accessed project metadata and issue statuses are cached in Redis.