# Database Architecture

## 1. Overview
JIDIS uses **PostgreSQL** running locally (or via Docker) to manage user configurations, persistent metadata (like demo links), and API caching to prevent rate-limiting. The schema uses a schema-per-service approach conceptually, though for a local app, it's organized within a single database.

## 2. Tables

### 2.1 `app_config` (Configuration Service)
Stores user credentials and settings.
- `id` (UUID, PK)
- `jira_domain` (VARCHAR)
- `jira_email` (VARCHAR)
- `jira_api_token` (VARCHAR, Encrypted)
- `github_token` (VARCHAR, Encrypted)
- `discord_webhook_url` (VARCHAR)
- `updated_at` (TIMESTAMP)

### 2.2 `ticket_metadata` (Storage Service)
Stores user-generated metadata linked to Jira tickets.
- `ticket_key` (VARCHAR, PK) - e.g., "JID-123"
- `demo_video_url` (VARCHAR, Nullable)
- `custom_notes` (TEXT, Nullable)
- `updated_at` (TIMESTAMP)

### 2.3 `monitored_repositories` (GitHub Service Config)
Stores which GitHub repositories should be scanned for PRs.
- `id` (UUID, PK)
- `owner` (VARCHAR) - e.g., "my-company"
- `repo_name` (VARCHAR) - e.g., "frontend-app"
- `is_active` (BOOLEAN) Default True

### 2.4 `api_cache` (Cache Layer)
Temporary storage to prevent excessive API calls.
- `cache_key` (VARCHAR, PK) - e.g., `jira_tickets_user1`
- `response_data` (JSONB)
- `expires_at` (TIMESTAMP)
- `created_at` (TIMESTAMP)

## 3. Indexes
- `idx_ticket_metadata_key` ON `ticket_metadata(ticket_key)`
- `idx_api_cache_expires` ON `api_cache(expires_at)`

## 4. Caching Strategy
- **Jira Tickets:** Cached for 5 minutes.
- **GitHub PRs:** Cached for 5 minutes.
- **Conflict Diffs:** Fetched on-demand, cached for 30 minutes unless refreshed.
