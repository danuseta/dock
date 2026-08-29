# PostgreSQL Configuration & Strategy

This document covers the internal PostgreSQL setup used by JIDIS as a resilient local cache.

## Database Connection Pooling
- **Tool:** PgBouncer (or built-in Prisma/Knex connection pooling).
- **Reason:** Microservices can quickly exhaust standard connection limits. Since this is a local app, we configure a lightweight connection pool (e.g., max 10 connections per service) to minimize RAM usage on the developer's machine.

## Schema Isolation
As defined in the architecture, each service connects ONLY to its respective schema:
- Jira Service Connection String: `postgresql://user:pass@localhost:5432/jidis?schema=jira_schema`
- GitHub Service Connection String: `postgresql://user:pass@localhost:5432/jidis?schema=github_schema`

## Migration Strategy
- **Framework:** Flyway or Prisma Migrate.
- **Execution:** Migrations are applied automatically on application startup.
- **Rollbacks:** Destructive changes are avoided. We use additive migrations (adding columns) to prevent data loss in the local cache.

## Data Retention
- To prevent the local database from growing indefinitely, a background cron job runs weekly to purge cached Tickets and PRs that have been in `CLOSED` or `DONE` status for more than 30 days.
