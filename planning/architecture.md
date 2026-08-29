# System Architecture Overview

## 1. Architectural Style
JIDIS utilizes a **Microservice-inspired modular architecture** running locally. The system is divided into focused modules: UI, BFF (Backend for Frontend), and domain-specific services.

## 2. C4 Context Diagram

```mermaid
C4Context
    title System Context diagram for JIDIS
    
    Person(dev, "Developer", "A developer tracking their tasks and PRs.")
    System(jidis, "JIDIS", "Local dashboard for tracking Jira tickets and GitHub PRs, and sending Discord updates.")
    
    System_Ext(jira, "Jira Cloud", "Source of tasks and tickets.")
    System_Ext(github, "GitHub", "Source of repositories and Pull Requests.")
    System_Ext(discord, "Discord", "Destination for summary updates.")
    
    Rel(dev, jidis, "Views tasks, links PRs, sends updates")
    Rel(jidis, jira, "Fetches assigned tickets", "REST/GraphQL")
    Rel(jidis, github, "Fetches PRs and conflict status", "GraphQL API")
    Rel(jidis, discord, "Sends formatted summaries", "Webhook")
```

## 3. C4 Container Diagram

```mermaid
C4Container
    title Container diagram for JIDIS
    
    Person(dev, "Developer", "Uses the Desktop App")
    
    Container(electron, "Electron Desktop App", "React/Vite", "Provides the user interface (Dashboard, Needs Attention).")
    Container(bff, "BFF GraphQL Service", "Node.js", "Aggregates data from underlying services for the UI.")
    
    Container(jira_svc, "Jira Service", "Node.js", "Handles Jira API authentication and ticket fetching.")
    Container(github_svc, "GitHub Service", "Node.js", "Handles GitHub API queries for PRs and conflicts.")
    Container(discord_svc, "Discord Service", "Node.js", "Handles message formatting and Webhook delivery.")
    Container(storage_svc, "Storage Service", "Node.js + PostgreSQL", "Manages local state, config, and demo links.")
    
    ContainerDb(db, "PostgreSQL Database", "PostgreSQL", "Stores user configs, demo links, and cached API responses.")
    
    Rel(dev, electron, "Interacts with")
    Rel(electron, bff, "Requests aggregated data", "GraphQL")
    
    Rel(bff, jira_svc, "Fetch tickets")
    Rel(bff, github_svc, "Fetch PRs")
    Rel(bff, discord_svc, "Send summaries")
    Rel(bff, storage_svc, "Get/Set config & links")
    
    Rel(storage_svc, db, "Reads/Writes")
```

## 4. Data Flow Description
1. **Load Dashboard:** UI requests `DashboardData` from BFF. BFF concurrently calls `Jira Service` for tickets and `Storage Service` for cached data.
2. **Enrich Tickets:** BFF calls `GitHub Service` using Jira ticket keys to find related PRs.
3. **Display:** BFF aggregates everything and returns a unified JSON to the UI.
4. **Send Update:** UI triggers `SendDiscordSummary` via BFF. BFF retrieves ticket details + PRs + Demo links, formats the payload, and sends it to `Discord Service`.
