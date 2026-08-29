# BFF GraphQL Controllers

## Resolvers
- **IssueResolver**: Handles fetching and mutating Jira issues, orchestrating calls to `jira-service`.
- **UserResolver**: Manages user profiles, permissions, resolving data via database or authentication service.
- **SyncResolver**: Manages data synchronization requests across services.

Each resolver delegates complex business logic to the underlying service layer.