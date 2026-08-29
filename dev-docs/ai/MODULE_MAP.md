# Module Map

## 1. Electron Main Process
- **Lifecycle Management**: App startup, tray icon, background execution.
- **IPC Handlers**: Communication with React renderer.
- **Local Storage**: Secure storage for Jira/GitHub credentials locally.

## 2. React Renderer (Frontend)
- **Dashboard View**: Aggregated list of Jira tickets.
- **PR View**: Status of associated PRs.
- **Discord Preview**: Formatted message preview before sending.

## 3. BFF (Backend for Frontend)
- **GraphQL API**: Resolvers for aggregating Jira and GitHub data.
- **Jira Service**: Wrappers for Jira REST API.
- **GitHub Service**: Wrappers for GitHub REST/GraphQL API.
- **Discord Service**: Webhook integration for sending messages.
