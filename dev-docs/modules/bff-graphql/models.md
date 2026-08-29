# BFF GraphQL Models

## GraphQL Types
```graphql
type Issue {
  id: ID!
  key: String!
  title: String!
  status: String!
  pullRequests: [PullRequest]
}

type PullRequest {
  id: ID!
  title: String!
  url: String!
  author: String!
}
```
## DTOs
- `CreateIssueInput`: DTO for creating an issue.
- `AuthPayload`: Contains JWT and user metadata.