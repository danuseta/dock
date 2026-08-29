# Timeline and Roadmap

## Phase 1: Planning (Current)
- Generate architecture, API contracts, PRD, and database schema.
- Finalize wireframes and design system.
- Output: `E:\jidis\planning\` fully populated.

## Phase 2: Foundation & Storage Service (Sprint 1)
- Initialize PostgreSQL database.
- Create Node.js Storage Service (CRUD for config and ticket metadata).
- Setup Docker environment.

## Phase 3: External Integrations (Sprint 2)
- Build Jira Service to fetch assigned tickets.
- Build GitHub Service to query GraphQL API for PRs and conflicts.
- Build Discord Service to format and post webhooks.

## Phase 4: BFF Layer (Sprint 3)
- Initialize Apollo GraphQL server.
- Wire GraphQL resolvers to Jira, GitHub, and Storage services.
- Implement API response caching to respect rate limits.

## Phase 5: Frontend UI - Electron & React (Sprint 4)
- Setup Vite + React + Electron shell.
- Implement Design System (Outfit font, minimal dark mode).
- Build Dashboard, Ticket Detail, and Settings views.
- Integrate with BFF GraphQL API.

## Phase 6: Polish & Testing (Sprint 5)
- End-to-end testing (Jira -> App -> Discord).
- UI/UX polish (micro-animations, loading states, error handling).
- Finalize documentation.
