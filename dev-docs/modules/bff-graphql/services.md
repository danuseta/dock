# BFF GraphQL Services

## Core Services
- **JiraClientService**: gRPC/HTTP client to communicate with `jira-service`.
- **GitHubClientService**: Communicates with `github-service` to fetch repo data.
- **DiscordClientService**: Sends notification payloads to `discord-service`.
- **AuthService**: Validates JWT tokens and handles session management before resolvers execute.