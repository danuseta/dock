# Jira Service Controllers

## IssueController
- `getIssue(req, res)`: Fetches an issue by ID or Key.
- `createIssue(req, res)`: Validates payload and creates issue in Jira.

## WebhookController
- `handleWebhook(req, res)`: Verifies Atlassian webhook signature and routes to appropriate service method.