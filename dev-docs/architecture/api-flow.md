# API Request-Response Flow

This document details the end-to-end API request-response flows within the JIDIS (Jira-Discord-Github Integration System) architecture.

## Overview
The API flow follows a Backend-for-Frontend (BFF) pattern using GraphQL as the primary interface for the Electron desktop client, routing requests to appropriate downstream microservices (Jira Service, GitHub Service, Discord Service).

## 1. Ticket Fetching Flow
This flow is triggered when the dashboard loads to retrieve user-assigned tickets and their associated GitHub Pull Requests.

```mermaid
sequenceDiagram
    participant UI as Electron UI
    participant BFF as BFF (GraphQL)
    participant JiraSvc as Jira Service
    participant GithubSvc as GitHub Service
    participant DB as PostgreSQL

    UI->>BFF: query { getTicketsWithPRs(userId) }
    BFF->>JiraSvc: GET /api/v1/tickets?assignee={userId}
    JiraSvc->>Jira API: GET /rest/api/3/search
    Jira API-->>JiraSvc: JSON Ticket Data
    JiraSvc->>DB: Update Local Cache (Jira Schema)
    JiraSvc-->>BFF: Ticket List

    loop For each Ticket
        BFF->>GithubSvc: GET /api/v1/prs?ticketKey={ticket.key}
        GithubSvc->>GitHub API: GET /search/issues?q={ticketKey} type:pr
        GitHub API-->>GithubSvc: JSON PR Data
        GithubSvc->>DB: Update Local Cache (GitHub Schema)
        GithubSvc-->>BFF: PR List
    end

    BFF-->>UI: Aggregated Tickets + PRs Data
```

## 2. On-Demand Conflict Check Flow
Instead of polling constantly, the system checks for Git merge conflicts on demand when the user views PR details.

```mermaid
sequenceDiagram
    participant UI as Electron UI
    participant BFF as BFF (GraphQL)
    participant GithubSvc as GitHub Service
    participant GitHub as GitHub API

    UI->>BFF: mutation { checkPRConflict(prId) }
    BFF->>GithubSvc: POST /api/v1/prs/{prId}/check-conflict
    GithubSvc->>GitHub: GET /repos/{owner}/{repo}/pulls/{prId}
    GitHub-->>GithubSvc: PR Status (mergeable)
    
    alt mergeable == false
        GithubSvc->>GitHub: Compare base...head
        GitHub-->>GithubSvc: Diff details
        GithubSvc-->>BFF: Conflict Status + Diff Files
    else
        GithubSvc-->>BFF: No Conflict
    end
    
    BFF-->>UI: Conflict Check Result
```

## 3. Discord Notification Flow
Triggered manually by the user to summarize the ticket and its PRs to Discord.

```mermaid
sequenceDiagram
    participant UI as Electron UI
    participant BFF as BFF (GraphQL)
    participant DiscordSvc as Discord Service
    participant Discord as Discord Webhook

    UI->>BFF: mutation { sendSummary(ticketId, demoLink) }
    BFF->>BFF: Aggregate Ticket & PR data
    BFF->>DiscordSvc: POST /api/v1/messages
    DiscordSvc->>DiscordSvc: Format Markdown Template
    DiscordSvc->>Discord: POST Webhook URL
    Discord-->>DiscordSvc: 204 No Content
    DiscordSvc-->>BFF: Success Status
    BFF-->>UI: Notification Sent
```
