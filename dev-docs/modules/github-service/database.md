# GitHub Service Database

## Schema
- `github_repositories`: Tracks monitored repositories.
- `github_pull_requests`: Cache of active PRs to reduce API calls.

## Caching
- ETag caching implemented via Redis to prevent rate limiting from GitHub API.