# ADR 002: Backend-For-Frontend (BFF) Pattern

## Status
Accepted

## Context
The Electron UI requires data from both Jira (Tickets) and GitHub (Pull Requests) to render the dashboard. Forcing the UI to make separate calls to multiple microservices and aggregate the data locally would lead to complex frontend logic and over-fetching.

## Decision
We will implement a Backend-For-Frontend (BFF) layer using GraphQL.

## Consequences
- **Positive:** The UI makes a single GraphQL query to retrieve perfectly shaped data.
- **Positive:** Aggregation logic (matching Jira tickets to GitHub PRs) is moved out of the UI layer.
- **Negative:** Adds an extra network hop and a new layer of code to maintain.
