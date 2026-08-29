# Project Mental Model

## JIDIS Flow
1. **User Auth**: User inputs Jira API Token, GitHub PAT, and Discord Webhook via the Settings UI. The BFF stores them in the local encrypted SQLite datastore and uses HttpOnly session cookies for unlock state.
2. **Dashboard Load**:
   - The React frontend requests Jira tickets assigned to the user from the BFF.
   - BFF fetches data from Jira API.
   - For each ticket, BFF searches GitHub for PRs mentioning the ticket key.
   - BFF aggregates this into a unified GraphQL response.
3. **Interaction**:
   - The user sees tickets grouped by status.
   - The user can see associated PRs, PR status, and merge conflicts.
   - The user can input demo URLs.
4. **Discord Summary**:
   - The user selects a ticket to report.
   - BFF generates a Markdown formatted summary.
   - BFF sends the summary to the configured Discord Webhook.

## Core Assumptions
- Fast local execution; no complex DB needed; SQLite or file-based JSON is sufficient.
- Personal use only.
