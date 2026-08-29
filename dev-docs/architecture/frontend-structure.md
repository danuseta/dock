# Frontend Web App & Electron UI

The JIDIS UI is an Electron-wrapped React/Next.js application, providing a native desktop feel with web technologies.

## Directory Structure
```text
jidis-desktop/
├── electron/
│   ├── main.js              # Electron Main Process (System tray, window mgmt)
│   ├── preload.js           # Secure IPC bridge
│   └── ipc-handlers.js      # Handlers for local secure storage access
├── src/
│   ├── components/          # Reusable UI components (Buttons, Cards, Badges)
│   ├── features/            # Feature-based modules (Tickets, PRs, Settings)
│   ├── graphql/             # Apollo Client queries/mutations
│   ├── pages/               # Routing pages (Dashboard, Config)
│   ├── store/               # Zustand state management
│   └── styles/              # Global CSS, CSS Modules
└── package.json
```

## State Management
- **Local UI State:** Managed by `Zustand` for lightweight, boilerplate-free state.
- **Server Data Caching:** Managed by `@apollo/client`. The Apollo cache handles normalization of Ticket and PR entities received from the BFF.
- **Persistent Local Config:** Credentials and webhook URLs are passed from the Main Process to the Renderer Process via IPC and are never stored in `localStorage`.

## Component Tree (Dashboard)
- `App`
  - `Sidebar` (Navigation)
  - `DashboardView`
    - `TicketList`
      - `TicketCard`
        - `TicketHeader` (Jira Info)
        - `PRStatusList` (GitHub Info)
          - `PRBadge` (Conflict/Merged status)
        - `ActionFooter` (Demo Link Input, Discord Send Button)
    - `UrgentAttentionPanel` (Highlights conflicts or stale PRs)

## IPC (Inter-Process Communication) Security
- `contextIsolation: true` is strictly enforced.
- The `preload.js` exposes only specific, necessary functions:
  - `window.api.getCredentials()`
  - `window.api.saveCredentials()`
