# GitHub Service Business Logic

## GithubApiClient
- Uses Octokit to communicate with GitHub.
- Manages installation access tokens.

## LinkerService
- Parses commit messages (e.g., `PROJ-123: Fix bug`) and emits events to link GitHub data to Jira issues.