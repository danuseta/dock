# Project Context

## JIDIS (Jira + GitHub + Discord Integrated System)

JIDIS is a personal desktop dashboard application designed to act as a bridge between Jira and GitHub. It aggregates tasks assigned to a single developer and matches them with their corresponding GitHub Pull Requests automatically based on ticket keys. Finally, it generates formatted summaries that can be sent directly to Discord.

## Core Purpose
To eliminate the manual process of context switching between Jira, GitHub, and Discord, and to provide a unified overview of all daily tasks and PRs for a single developer.

## Key Features
- Jira ticket aggregation based on assignee and status.
- Automatic PR matching via ticket keys in branches or titles.
- PR status tracking (open, merged, conflicted).
- Discord summary generation and automation.
- Electron-based Windows desktop application.
- GraphQL BFF for optimized data fetching.

## Architecture
- **Frontend**: Electron Desktop App (React/Vite).
- **Backend**: BFF (Backend for Frontend) using GraphQL.
- **Integrations**: Jira API, GitHub API, Discord Webhooks.
