# Jira Service Routes

## Endpoints (Internal REST / gRPC)
- `GET /api/v1/issues/:key`: Retrieve an issue.
- `POST /api/v1/issues`: Create an issue.
- `POST /api/v1/webhooks/jira`: Receive Atlassian webhooks.

## Event Handlers
- `onIssueCreated`: Process webhook when an issue is created in Jira.
- `onIssueTransitioned`: Process webhook when an issue changes status.