# GitHub Service Controllers

## PullRequestController
- `listPRs`: Handles fetching and filtering PRs.
- `mergePR`: Handles merging operations.

## WebhookController
- `handleGithubEvent`: Validates `X-Hub-Signature` and dispatches events based on `X-GitHub-Event` header.