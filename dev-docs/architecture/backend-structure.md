# Backend Structure & Responsibilities

JIDIS backend is structured using a Microservices Architecture deployed alongside the Electron app or as separate lightweight containers, utilizing a monorepo approach for local development.

## Directory Structure
```text
jidis-backend/
├── packages/
│   ├── bff-graphql/         # GraphQL Gateway / Backend-For-Frontend
│   ├── service-jira/        # Microservice handling Jira integrations
│   ├── service-github/      # Microservice handling GitHub integrations
│   ├── service-discord/     # Microservice handling Discord outbound messages
│   └── shared-libs/         # Common utilities, logger, and DB clients
├── docker-compose.yml       # Local deployment definitions
└── package.json             # Root workspace configuration
```

## Service Responsibilities

### 1. BFF (Backend-for-Frontend)
- **Role:** Single entry point for the Electron UI.
- **Protocol:** GraphQL over HTTP.
- **Responsibilities:**
  - Aggregate data from downstream services (Jira + GitHub).
  - Handle rate-limiting and circuit-breaking.
  - Expose a unified schema tailored for the UI.

### 2. Jira Service
- **Role:** Communicates with Jira Cloud API.
- **Protocol:** REST/gRPC (internal).
- **Responsibilities:**
  - Sync user-assigned tickets.
  - Parse ticket keys, statuses, and assignees.
  - Cache tickets in the `jira_schema` PostgreSQL database.

### 3. GitHub Service
- **Role:** Communicates with GitHub API (REST & GraphQL).
- **Protocol:** REST/gRPC (internal).
- **Responsibilities:**
  - Discover Pull Requests based on ticket keys.
  - Perform on-demand merge conflict analysis.
  - Track PR statuses (Open, Merged, Closed, Review requested).
  - Store cached PR data in the `github_schema` PostgreSQL database.

### 4. Discord Service
- **Role:** Handles outbound notifications.
- **Protocol:** REST (internal).
- **Responsibilities:**
  - Format incoming payload into Discord-friendly markdown.
  - Dispatch webhook requests.
  - Handle retries for 429 Too Many Requests responses from Discord.
