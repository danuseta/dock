# Jira Service

## Overview
The Jira Service is responsible for all interactions with the external Jira Cloud/Server APIs. It acts as an anti-corruption layer, normalizing Jira's complex data structures into a unified format for JIDIS.

## Responsibilities
- Webhook ingestion from Jira.
- Polling or syncing Jira data.
- Normalizing Issue, Sprint, and Epic data.
- Handling Atlassian OAuth2/API token authentication.