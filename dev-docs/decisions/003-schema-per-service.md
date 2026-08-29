# ADR 003: Schema-per-Service Database Pattern

## Status
Accepted

## Context
In a microservices architecture, sharing a single database schema creates tight coupling between services. However, running completely separate database servers for each service on a local machine would consume excessive RAM.

## Decision
We will run a single PostgreSQL instance but enforce logical isolation by giving each microservice its own database schema (`jira_schema`, `github_schema`).

## Consequences
- **Positive:** Maintains data isolation and service autonomy.
- **Positive:** Keeps memory usage low by running only one PostgreSQL engine.
- **Negative:** Requires strict discipline not to write cross-schema queries. Aggregation must happen at the BFF level.
