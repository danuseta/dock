# BFF GraphQL Routes/Schema

## Endpoints
- `POST /graphql`: Main endpoint for all queries and mutations.
- `GET /health`: Health check endpoint.

## Queries
- `getIssue(id: ID!)`: Fetches a Jira issue along with linked GitHub PRs.
- `getPullRequests()`: Lists active PRs from GitHub service.

## Mutations
- `createIssue(...)`: Creates a new issue in Jira and optionally notifies Discord.
- `syncRepository(...)`: Triggers a sync for GitHub data.