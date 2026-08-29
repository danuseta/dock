# GitHub Service Routes

## Endpoints
- `GET /api/v1/repos/:owner/:repo/prs`: List PRs.
- `POST /api/v1/webhooks/github`: Receive GitHub App webhooks.

## Event Handlers
- `onPullRequestOpened`: Triggers analysis or links PR to Jira issue.
- `onPush`: Scans commit messages for issue keys.