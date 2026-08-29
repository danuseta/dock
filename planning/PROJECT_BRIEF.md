# Project Brief: JIDIS (Dev Task & PR Tracker Dashboard)

## 1. Project Overview
**Name:** JIDIS (Dev Task & PR Tracker Dashboard)
**Type:** Personal Developer Productivity Tool (Desktop/Local Web App)
**Context:** Developers often switch between Jira (task tracking) and GitHub (code tracking), making it difficult to maintain context. JIDIS bridges this gap by automatically associating Jira tickets with their corresponding GitHub Pull Requests (PRs).

## 2. Objectives
- **Centralize Workflow:** Provide a single dashboard for developers to view all assigned Jira tickets alongside related GitHub PRs.
- **Automate Tracking:** Automatically link PRs to Jira tickets based on ticket keys in branch names or PR titles.
- **Streamline Communication:** Automate the generation and sending of status summaries to Discord.
- **Highlight Blockers:** Immediately surface PR conflicts or stale reviews requiring attention.

## 3. Stakeholders
- **Primary User:** Solo Developer (Personal Use).
- **External Systems:** Jira Cloud, GitHub, Discord.

## 4. Scope Boundaries

### 4.1 In Scope
- Fetching and displaying assigned Jira tickets grouped by status.
- Fetching and linking GitHub PRs based on Jira ticket keys.
- Displaying PR statuses (Open, Merged, Draft, Conflicted) and checking for specific file conflicts on demand.
- Attaching manual demo video links to tickets.
- Generating and posting formatted ticket summaries to Discord.
- "Needs Attention" view for stalled PRs or conflicts.
- Local execution as a Web App or packaged Electron Desktop App (Windows).

### 4.2 Out of Scope
- Multi-user authentication, roles, or team management (SaaS capabilities).
- Replacing the existing standalone Jira/GitHub Discord webhooks.
- Bidirectional syncing (e.g., updating Jira status from the app).
- Historical analytics or reporting beyond active tasks.

## 5. Success Metrics
- **Time Saved:** Reduce the time spent compiling and sending Discord updates from minutes to a single click.
- **Context Switching:** Reduce tabs opened by maintaining Jira and GitHub status visibility in a single screen.
- **Blocker Resolution:** Decrease the average time a PR sits in a "conflicted" or "stale" state.

## 6. Assumptions & Constraints
- **Assumptions:** Branch names or PR titles strictly follow the convention of including the Jira Ticket Key (e.g., `JID-123-feature`).
- **Constraints:** Must run locally; data is stored securely on the user's machine. Heavy operations (conflict file diffs) should be on-demand to maintain performance.
