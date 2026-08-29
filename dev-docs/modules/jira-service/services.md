# Jira Service Business Logic

## JiraApiClient
- Handles raw HTTP requests to Atlassian APIs.
- Manages rate limits and retries (e.g., HTTP 429).

## IssueSyncService
- Responsible for transforming raw Jira JSON into the JIDIS internal standard format.
- Emits `IssueUpdated` events to the internal message broker (e.g., RabbitMQ/Kafka).