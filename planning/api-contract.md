# API Contracts (GraphQL & Internal REST)

## 1. BFF GraphQL Schema (Frontend to BFF)

```graphql
type Ticket {
  key: String!
  title: String!
  status: String!
  url: String!
  demoVideoUrl: String
  pullRequests: [PullRequest!]!
}

type PullRequest {
  id: ID!
  title: String!
  url: String!
  state: PRState!
  hasConflict: Boolean!
  repository: String!
}

enum PRState {
  OPEN
  DRAFT
  MERGED
  CLOSED
}

type Query {
  "Fetch all active tickets for the user, including linked PRs"
  dashboardTickets: [Ticket!]!
  
  "Fetch a specific ticket by its Jira key"
  ticketDetail(key: String!): Ticket
  
  "Fetch PRs that need attention (conflicts, stale)"
  needsAttention: [PullRequest!]!
}

type Mutation {
  "Update or attach a demo video link to a ticket"
  updateDemoLink(ticketKey: String!, url: String!): Ticket
  
  "Trigger sending a summary to Discord"
  sendDiscordSummary(ticketKey: String!): Boolean!
  
  "Update App Configuration"
  updateConfig(jiraToken: String, githubToken: String, discordWebhook: String): Boolean!
}
```

## 2. Internal Microservice Contracts (BFF to Services)

### 2.1 Jira Service
- **GET** `/internal/jira/tickets`
  - **Response:** `Array<{ key, title, status, url }>`

### 2.2 GitHub Service
- **GET** `/internal/github/prs?ticketKey=JID-123`
  - **Response:** `Array<{ id, title, url, state, hasConflict, repository }>`
- **GET** `/internal/github/pr/conflict-details?repo=my-app&pr=45`
  - **Response:** `Array<{ filename, conflictType }>`

### 2.3 Discord Service
- **POST** `/internal/discord/send-summary`
  - **Payload:**
    ```json
    {
      "ticket": { "key": "JID-123", "title": "Add Login" },
      "prs": [ { "url": "...", "status": "MERGED" } ],
      "demoVideo": "https://loom.com/..."
    }
    ```
  - **Response:** `{ success: true }`

### 2.4 Storage Service
- **GET** `/internal/storage/ticket-meta/:key`
  - **Response:** `{ demoVideoUrl: "...", notes: "..." }`
- **POST** `/internal/storage/ticket-meta/:key`
  - **Payload:** `{ demoVideoUrl: "..." }`
