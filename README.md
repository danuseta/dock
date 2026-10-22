# DOCK

DOCK (Development Operations Control Kit) is a board for Jira tickets, their pull requests and the agents that work on them. The backend is one GraphQL server with SQLite (`backend/bff-graphql`); the frontend is a Vite app (`frontend`).

## Run the workspace DOCK on your own PC

In production the workspace DOCK runs on a Coder workspace, and the agents run on that same machine. You can play both parts on one PC. "workspace" is only the name of a machine in DOCK, so you don't need to host anything.

| Part | Where it runs |
|---|---|
| DOCK backend (`:4000`) and frontend (`:3000`), started with `DOCK_MODE=workspace` | your PC |
| The bridge `dock-chat.cjs`, which takes queued messages from DOCK and runs Claude Code | your PC |
| Claude Code with the sous skill and agents | your PC |

DOCK itself only keeps the queue and the ledgers. The kit from [claude-config](https://github.com/danuseta/claude-config) does the work: the bridge, `status.cjs` (the ledger) and the sous agents. Without the kit you can open DOCK and look around, but a chat or a cron run waits in the queue forever.

### Before you start

- Node.js 20 or newer, and git.
- Claude Code installed.
- If you want sous to work on real tickets: a Jira API token and a GitHub token. Both go into DOCK's System Settings.

Sous does real work on this PC. It creates worktrees, runs tests, and can push branches and open pull requests with the GitHub account this PC is logged in with. Try it on a test ticket first.

### 1. Start DOCK

Install from the repo root. It uses npm workspaces, and installing inside a workspace folder removes the other workspace's packages.

```bash
git clone https://github.com/danuseta/dock
cd dock
npm install
```

Create `backend/bff-graphql/.env`:

```
DATABASE_URL=file:./data/dock.db
ENCRYPTION_KEY=<any long random string; it encrypts the tokens saved in Settings>
CORS_ORIGIN=http://localhost:3000
```

Create the database and start the backend:

```bash
cd backend/bff-graphql
npm run db:generate
npm run db:push
DOCK_MODE=workspace npm run dev
```

In a second terminal, start the frontend:

```bash
cd frontend
npm run dev
```

Open http://localhost:3000.

`DOCK_MODE=workspace` is required. Without it DOCK starts as the laptop DOCK, which only monitors: it answers the bridge's chat routes with 404, hides the Confirm, Change and answer buttons, and never runs the automatic broadcast. On Windows PowerShell, set the variable first: `$env:DOCK_MODE='workspace'; npm run dev`.

### 2. Create an ingest token for the machine `workspace`

1. Open **System Settings → Ingest tokens**.
2. Enter any name and set **Machine** to `workspace`. Do not leave Machine empty: an empty Machine creates a token for `laptop`.
3. Copy the token (`dock_ing_...`). It is shown once.

The kit sends this token with everything it reports to DOCK and with every request for queued work. DOCK reads the machine from the token, so with this token your PC shows up in DOCK as `workspace`.

Fill in **Jira** and **GitHub** under System Settings if sous should read tickets and open pull requests.

### 3. Install the kit and start the bridge

```bash
git clone https://github.com/danuseta/claude-config
cd claude-config
node install/install.cjs --dry-run    # shows what it would write
node install/install.cjs --apply
```

The installer writes to `~/.claude-kantor` on Windows and to `~/.claude` on Linux; `--config-dir <dir>` picks another folder. It installs the owner's whole Claude Code setup (skills, agents, rules, hooks), so read the dry run before you apply it.

On Windows the bridge runs Claude Code with `CLAUDE_CONFIG_DIR` set to that folder, so log in to Claude Code once for that folder:

```powershell
$env:CLAUDE_CONFIG_DIR="$HOME/.claude-kantor"; claude    # then /login
```

Point the kit at your DOCK with the token from step 2. Either set two environment variables:

```bash
export DOCK_INGEST_URL=http://localhost:4000/ingest/orchestrator
export DOCK_INGEST_TOKEN=dock_ing_...
```

or write them once to `<config folder>/kit/dock.json`:

```json
{ "url": "http://localhost:4000/ingest/orchestrator", "token": "dock_ing_..." }
```

Check the setup, then start the bridge and leave it running:

```bash
node <config folder>/kit/dock-chat.cjs check    # prints the url and "token: set", and the claude command it found
node <config folder>/kit/dock-chat.cjs run
```

### 4. Try it

1. Within a minute the machine `workspace` shows as online in DOCK.
2. Open a chat and send `Pakai skill sous: kerjakan QRD-1234` (use a test ticket).
3. The bridge picks the message up, sous starts working, and the ticket shows up on the Agents page with its stage, decisions and questions.

### When something does not work

| Message | Cause and fix |
|---|---|
| `Unknown machine` | DOCK has no ingest token for `workspace`. Create one (step 2). |
| `workspace is offline. Start it, then send.` | No bridge has asked DOCK for work in the last minute. Start `dock-chat.cjs run`, and check its URL and token with `dock-chat.cjs check`. |
| The bridge logs `401` | The token is wrong or was revoked. Create a new one. |
| The bridge logs `404` on `/chat/...` | The backend runs without `DOCK_MODE=workspace`. Restart it with the variable. |
| A session stays queued and the bridge says the claude command was not found | Claude Code is not on the PATH of the terminal that runs the bridge. |

## Development

```bash
npm run lint --workspace=frontend
npm run build:app
npm run test:all
```

These are the steps CI runs. Run them before you push.
