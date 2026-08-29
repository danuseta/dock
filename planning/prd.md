# Product Requirements Document (PRD)

## 1. Introduction & Background
Currently, developers deal with disjointed workflows. Jira tracks tasks, GitHub tracks code, and Discord receives isolated notifications from both. This forces developers to manually gather links (Jira, Frontend PR, Backend PR, Demo Videos) and compile daily update messages. This repetitive manual process is inefficient and prone to missing context.

## 2. Purpose
JIDIS is a personalized dashboard bridging Jira and GitHub. It allows developers to:
- See all assigned tickets grouped by status.
- View linked PRs automatically without manual searching.
- Track PR statuses (Merged, Open, Conflicted).
- Automate Discord summary updates with a single click.

## 3. Target Audience
- **Single Developer** managing tasks locally. No multi-tenant support required.

## 4. Scope

### In-Scope
1. **Ticket Aggregation:** Fetch and display Jira tickets assigned to the user.
2. **PR Matching:** Automatically link GitHub PRs to tickets using ticket keys (e.g., `PROJ-123`).
3. **PR Status Tracking:** Highlight states (Open, Draft, Conflict, Merged). Allow on-demand conflict details.
4. **Demo Links:** Persistent manual entry for demo video URLs per ticket.
5. **Discord Integration:** One-click summary generation and dispatch to Discord.
6. **Focus View:** "Needs Attention" highlights for conflicts or stale reviews.
7. **Cross-Platform:** Electron desktop app for Windows or local web app.

### Out-of-Scope
- Multi-user management.
- Modifying external systems' webhooks.
- Historical analytics.

## 5. Use Cases & User Journey
1. **Daily Standup Prep:** Developer opens JIDIS, views active tickets, checks which PRs are merged, and clicks "Send to Discord" to share updates.
2. **Review Management:** Developer checks the "Needs Attention" tab, sees a PR has a conflict, clicks to view conflicted files, and resolves them locally.

## 6. Assumptions
- Branch/PR naming conventions are strictly followed.
- User provides valid Personal Access Tokens (PAT) for Jira, GitHub, and Discord Webhooks.
- Local storage is secure enough for credentials.

## 7. Technical Constraints
- Application must be lightweight.
- Intensive tasks (e.g., fetching full diffs for conflicts) must be lazy-loaded on user request.
- Demo links require manual input since they are hosted externally (e.g., Loom, Google Drive).

## 8. Success Metrics
- Zero manual switching between Jira and GitHub for daily status checks.
- One-click Discord updates.
- Faster response times to PR conflicts.
