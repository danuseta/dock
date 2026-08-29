# Database Architecture

JIDIS utilizes PostgreSQL with a **Schema-per-Service** pattern to maintain data isolation while minimizing infrastructure overhead for a personal-use desktop tool.

## Philosophy
- **One Database, Multiple Schemas:** Each microservice has its own isolated schema (`jira_schema`, `github_schema`, `core_schema`).
- **No Cross-Schema Joins:** Services cannot directly query another service's schema. Data aggregation is handled at the BFF layer.
- **Cache Fallback:** The database acts primarily as a reliable local cache. If APIs are unreachable, the UI falls back to the most recent DB snapshot.

## Schema Definitions

### 1. Schema: `jira_schema`
Managed exclusively by the **Jira Service**.

**Table: `tickets`**
- `id` (UUID, Primary Key)
- `ticket_key` (VARCHAR, Unique Index) - e.g., 'JID-123'
- `title` (VARCHAR)
- `status` (VARCHAR)
- `assignee_id` (VARCHAR)
- `last_synced_at` (TIMESTAMP)

### 2. Schema: `github_schema`
Managed exclusively by the **GitHub Service**.

**Table: `pull_requests`**
- `id` (UUID, Primary Key)
- `pr_number` (INT)
- `repository` (VARCHAR)
- `title` (VARCHAR)
- `url` (VARCHAR)
- `state` (VARCHAR) - OPEN, MERGED, CLOSED
- `has_conflict` (BOOLEAN)
- `ticket_key` (VARCHAR, Index) - Parsed from PR title/branch.
- `last_synced_at` (TIMESTAMP)

### 3. Schema: `core_schema`
Managed by **BFF** or a separate **Config Service**.

**Table: `user_settings`**
- `id` (UUID, Primary Key)
- `discord_webhook_url` (VARCHAR, Encrypted)
- `jira_domain` (VARCHAR)
- `sync_interval_minutes` (INT)

## Migrations
Migrations are managed per-service using tools like Prisma or Flyway. Each service runs its migrations on startup targeting its specific schema.
