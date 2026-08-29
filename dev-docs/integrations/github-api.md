# GitHub API Integration Guide

JIDIS interacts with GitHub to fetch Pull Request statuses and detect conflicts.

## Authentication
- Uses a **Personal Access Token (PAT)** with `repo` read scopes.
- Stored securely in the local OS vault.

## Endpoints Used

### 1. Search PRs by Ticket Key
Since a single ticket might span multiple repos (e.g., Frontend and Backend), we use the GitHub Search API.
- **Endpoint:** `GET /search/issues`
- **Query:** `q={Ticket-Key} type:pr author:@me`
- **Behavior:** This finds any PR created by the user where the title or branch contains the Jira Ticket Key (e.g., `JID-123`).

### 2. Check PR Details & Mergeability
- **Endpoint:** `GET /repos/{owner}/{repo}/pulls/{pull_number}`
- **Purpose:** Retrieves the `mergeable` boolean flag.
  - If `true`: No conflicts.
  - If `false`: Conflicts exist.
  - If `null`: GitHub is still calculating (JIDIS will retry after a short delay).

### 3. Simulate Merge Conflicts (On-Demand)
If `mergeable` is false, the user can request details.
- **Endpoint:** `GET /repos/{owner}/{repo}/compare/{base}...{head}`
- **Purpose:** Returns the files changed. JIDIS processes this to show which files specifically have conflict markers or diverge incompatibly.

## Best Practices Implemented
- **Avoid Polling Conflicts:** The `mergeable` state is only fetched when the user explicitly expands the PR view in the UI (On-Demand) to save API quota and keep the app lightweight.
- **GraphQL Fallback:** For complex repo structures, the GitHub GraphQL API (`v4`) is available to batch PR status requests in a single query.
