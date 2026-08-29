# ADR 001: Microservices Architecture

## Status
Accepted

## Context
JIDIS integrates with multiple distinct external APIs (Jira, GitHub, Discord). Each integration has different failure modes, rate limits, and authentication patterns. A monolithic backend would tightly couple these concerns, meaning a failure in GitHub API parsing could potentially bring down the Jira fetching logic.

## Decision
We will adopt a lightweight Microservices Architecture where each external domain is handled by a dedicated service (Jira Service, GitHub Service, Discord Service), orchestrated by a central BFF.

## Consequences
- **Positive:** Domain isolation. If the Discord Webhook API changes, only the Discord Service needs updates.
- **Positive:** Scalable development pattern for the future.
- **Negative:** Increased operational overhead for a desktop app. We will mitigate this by using Docker Compose for local execution or running the services as child processes inside the Electron app.
