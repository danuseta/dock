# Module Breakdown

## 1. Electron Desktop / UI (Frontend)
**Tech Stack:** React, Vite, Tailwind CSS (or Vanilla CSS per user preference), Electron.
**Responsibility:** Provides the user interface. It communicates exclusively with the BFF GraphQL layer.
**Key Components:**
- `Dashboard`: Lists all tickets grouped by Jira status.
- `TicketDetail`: Shows specific ticket info, PRs, and a form to add a demo link.
- `NeedsAttention`: A filtered view showing only tickets with conflicted PRs or stale PRs.
- `Settings`: UI to manage Jira/GitHub tokens and Discord webhook.

## 2. BFF GraphQL Layer
**Tech Stack:** Node.js, Apollo Server / GraphQL Yoga.
**Responsibility:** Acts as the single entry point for the frontend. It aggregates data from the Jira, GitHub, and Storage services so the UI can make a single query (e.g., fetching a ticket with its PRs and demo links combined).
**Key Behaviors:** Concurrent fetching, error handling for partial failures (e.g., if GitHub is down but Jira works).

## 3. Jira Service
**Tech Stack:** Node.js, Axios, Atlassian Jira REST API.
**Responsibility:** Fetches tickets assigned to the user.
**Key Endpoints Consumed:** `/rest/api/3/search?jql=assignee=currentuser()`
**Key Behaviors:** Transforms Jira's verbose JSON into a clean `Ticket` domain model.

## 4. GitHub Service
**Tech Stack:** Node.js, Octokit (GitHub GraphQL API).
**Responsibility:** Searches for Pull Requests across monitored repositories based on the Jira ticket key (e.g., `JID-123`).
**Key Endpoints Consumed:** GitHub GraphQL API (`search` query).
**Key Behaviors:** Evaluates PR mergeability, draft status, and fetches conflict details when requested.

## 5. Discord Service
**Tech Stack:** Node.js, Axios.
**Responsibility:** Receives a structured payload (Ticket + PRs + Demo Video) and formats it into a rich Discord Embed message.
**Key Endpoints Consumed:** Discord Webhook URL.
**Key Behaviors:** Handles Discord rate limits and formats Markdown beautifully.

## 6. Storage Service
**Tech Stack:** Node.js, PostgreSQL (or SQLite for local-only).
**Responsibility:** Manages local data that external systems don't handle: User configuration, app settings, and manually attached demo video links for tickets.
**Key Behaviors:** Reads/writes to the database, manages caching layers.
