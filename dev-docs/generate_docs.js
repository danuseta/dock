const fs = require('fs');
const path = require('path');

const baseDir = 'E:/jidis/dev-docs/modules';

const docs = {
    "bff-graphql": {
        "README.md": "# BFF GraphQL Module\n\n## Overview\nThe BFF (Backend-For-Frontend) GraphQL module acts as the central API gateway for the JIDIS application. It aggregates data from various underlying microservices (Jira, GitHub, Discord, Storage) and provides a unified GraphQL interface for the Electron desktop client and any web interfaces.\n\n## Responsibilities\n- Schema federation and stitching.\n- Authentication and authorization middleware.\n- Rate limiting and request validation.\n- Orchestrating complex mutations spanning multiple services.",
        "routes.md": "# BFF GraphQL Routes/Schema\n\n## Endpoints\n- `POST /graphql`: Main endpoint for all queries and mutations.\n- `GET /health`: Health check endpoint.\n\n## Queries\n- `getIssue(id: ID!)`: Fetches a Jira issue along with linked GitHub PRs.\n- `getPullRequests()`: Lists active PRs from GitHub service.\n\n## Mutations\n- `createIssue(...)`: Creates a new issue in Jira and optionally notifies Discord.\n- `syncRepository(...)`: Triggers a sync for GitHub data.",
        "controllers.md": "# BFF GraphQL Controllers\n\n## Resolvers\n- **IssueResolver**: Handles fetching and mutating Jira issues, orchestrating calls to `jira-service`.\n- **UserResolver**: Manages user profiles, permissions, resolving data via database or authentication service.\n- **SyncResolver**: Manages data synchronization requests across services.\n\nEach resolver delegates complex business logic to the underlying service layer.",
        "services.md": "# BFF GraphQL Services\n\n## Core Services\n- **JiraClientService**: gRPC/HTTP client to communicate with `jira-service`.\n- **GitHubClientService**: Communicates with `github-service` to fetch repo data.\n- **DiscordClientService**: Sends notification payloads to `discord-service`.\n- **AuthService**: Validates JWT tokens and handles session management before resolvers execute.",
        "models.md": "# BFF GraphQL Models\n\n## GraphQL Types\n```graphql\ntype Issue {\n  id: ID!\n  key: String!\n  title: String!\n  status: String!\n  pullRequests: [PullRequest]\n}\n\ntype PullRequest {\n  id: ID!\n  title: String!\n  url: String!\n  author: String!\n}\n```\n## DTOs\n- `CreateIssueInput`: DTO for creating an issue.\n- `AuthPayload`: Contains JWT and user metadata.",
        "database.md": "# BFF GraphQL Database\n\n## Ownership\nThe BFF module does not own any persistent database tables directly. It acts as an aggregator.\n\n## Caching\n- **Redis**: Used for query caching, session storage, and rate-limiting counters.\n- **Apollo Cache Control**: Defines cache max-age and scopes for GraphQL responses.",
        "dependencies.md": "# BFF GraphQL Dependencies\n\n## Internal\n- Protobuf definitions or shared TS interfaces for `jira-service`, `github-service`, `discord-service`.\n\n## External NPM\n- `@apollo/server`\n- `graphql`\n- `express`\n- `redis`\n- `jsonwebtoken`",
        "views.md": "# BFF GraphQL Views\n\n## UI Components\nNone. This is a purely backend service.\n\n## API Response Structures\nFollows standard GraphQL JSON response format:\n```json\n{\n  \"data\": {\n    \"getIssue\": {\n      \"id\": \"1\",\n      \"title\": \"Fix bug\"\n    }\n  },\n  \"errors\": []\n}\n```"
    },
    "jira-service": {
        "README.md": "# Jira Service\n\n## Overview\nThe Jira Service is responsible for all interactions with the external Jira Cloud/Server APIs. It acts as an anti-corruption layer, normalizing Jira's complex data structures into a unified format for JIDIS.\n\n## Responsibilities\n- Webhook ingestion from Jira.\n- Polling or syncing Jira data.\n- Normalizing Issue, Sprint, and Epic data.\n- Handling Atlassian OAuth2/API token authentication.",
        "routes.md": "# Jira Service Routes\n\n## Endpoints (Internal REST / gRPC)\n- `GET /api/v1/issues/:key`: Retrieve an issue.\n- `POST /api/v1/issues`: Create an issue.\n- `POST /api/v1/webhooks/jira`: Receive Atlassian webhooks.\n\n## Event Handlers\n- `onIssueCreated`: Process webhook when an issue is created in Jira.\n- `onIssueTransitioned`: Process webhook when an issue changes status.",
        "controllers.md": "# Jira Service Controllers\n\n## IssueController\n- `getIssue(req, res)`: Fetches an issue by ID or Key.\n- `createIssue(req, res)`: Validates payload and creates issue in Jira.\n\n## WebhookController\n- `handleWebhook(req, res)`: Verifies Atlassian webhook signature and routes to appropriate service method.",
        "services.md": "# Jira Service Business Logic\n\n## JiraApiClient\n- Handles raw HTTP requests to Atlassian APIs.\n- Manages rate limits and retries (e.g., HTTP 429).\n\n## IssueSyncService\n- Responsible for transforming raw Jira JSON into the JIDIS internal standard format.\n- Emits `IssueUpdated` events to the internal message broker (e.g., RabbitMQ/Kafka).",
        "models.md": "# Jira Service Models\n\n## Domain Models\n- `JiraIssue`: Represents a normalized Jira ticket.\n- `JiraUser`: Represents an Atlassian user.\n\n## DTOs\n- `JiraWebhookPayload`: Structure of incoming webhook data.\n- `IssueCreateDTO`: Normalized input for creating issues.",
        "database.md": "# Jira Service Database\n\n## Schema\n- `jira_issues`: Cache of recently accessed or synced issues.\n- `jira_webhooks_log`: Audit log of received webhooks.\n- `jira_sync_state`: Tracks the last synced timestamp for polling fallbacks.\n\n## Caching\n- Frequently accessed project metadata and issue statuses are cached in Redis.",
        "dependencies.md": "# Jira Service Dependencies\n\n## Internal\n- JIDIS Common logger and message broker modules.\n\n## External NPM\n- `axios` (for HTTP calls)\n- `pg` or `typeorm` (Database)\n- `amqplib` (RabbitMQ for events)",
        "views.md": "# Jira Service Views\n\n## API Responses\nInternal REST responses follow a standard format:\n```json\n{\n  \"success\": true,\n  \"data\": { \"key\": \"PROJ-123\", \"status\": \"In Progress\" }\n}\n```"
    },
    "github-service": {
        "README.md": "# GitHub Service\n\n## Overview\nThe GitHub Service manages interactions with GitHub APIs, handling repository data, pull requests, commits, and GitHub Actions workflows.\n\n## Responsibilities\n- GitHub App authentication and token lifecycle.\n- Processing GitHub Webhooks (push, pull_request, workflow_run).\n- Normalizing commit and PR data for linking to Jira issues.",
        "routes.md": "# GitHub Service Routes\n\n## Endpoints\n- `GET /api/v1/repos/:owner/:repo/prs`: List PRs.\n- `POST /api/v1/webhooks/github`: Receive GitHub App webhooks.\n\n## Event Handlers\n- `onPullRequestOpened`: Triggers analysis or links PR to Jira issue.\n- `onPush`: Scans commit messages for issue keys.",
        "controllers.md": "# GitHub Service Controllers\n\n## PullRequestController\n- `listPRs`: Handles fetching and filtering PRs.\n- `mergePR`: Handles merging operations.\n\n## WebhookController\n- `handleGithubEvent`: Validates `X-Hub-Signature` and dispatches events based on `X-GitHub-Event` header.",
        "services.md": "# GitHub Service Business Logic\n\n## GithubApiClient\n- Uses Octokit to communicate with GitHub.\n- Manages installation access tokens.\n\n## LinkerService\n- Parses commit messages (e.g., `PROJ-123: Fix bug`) and emits events to link GitHub data to Jira issues.",
        "models.md": "# GitHub Service Models\n\n## Domain Models\n- `PullRequest`: Normalized PR data.\n- `Commit`: Normalized commit data.\n\n## DTOs\n- `GithubWebhookDTO`: Typed payload for webhooks.",
        "database.md": "# GitHub Service Database\n\n## Schema\n- `github_repositories`: Tracks monitored repositories.\n- `github_pull_requests`: Cache of active PRs to reduce API calls.\n\n## Caching\n- ETag caching implemented via Redis to prevent rate limiting from GitHub API.",
        "dependencies.md": "# GitHub Service Dependencies\n\n## Internal\n- Event definitions for issue linking.\n\n## External NPM\n- `octokit`\n- `crypto` (for webhook signature validation)\n- `express`",
        "views.md": "# GitHub Service Views\n\n## API Responses\n```json\n{\n  \"pr_id\": 123,\n  \"state\": \"open\",\n  \"linked_issues\": [\"PROJ-123\"]\n}\n```"
    },
    "discord-service": {
        "README.md": "# Discord Service\n\n## Overview\nThe Discord Service handles all outbound notifications and inbound bot commands for JIDIS.\n\n## Responsibilities\n- Managing the Discord Bot lifecycle.\n- Formatting and sending rich embed notifications (e.g., PR merged, Issue blocked).\n- Processing slash commands from users in Discord.",
        "routes.md": "# Discord Service Routes\n\n## Endpoints\n- `POST /api/v1/notifications/send`: Internal endpoint to trigger a Discord message.\n\n## Event Handlers (Discord WS)\n- `interactionCreate`: Handles slash commands.\n- `messageCreate`: Handles text-based bot interactions.",
        "controllers.md": "# Discord Service Controllers\n\n## NotificationController\n- `sendNotification`: Validates payload and queues the message for Discord.\n\n## CommandController\n- `handleIssueCommand`: Processes `/issue` slash command.\n- `handleStatusCommand`: Processes `/status` slash command.",
        "services.md": "# Discord Service Business Logic\n\n## DiscordBotManager\n- Connects to Discord Gateway.\n- Registers global and guild-specific slash commands.\n\n## EmbedBuilderService\n- Translates internal JIDIS events (e.g., `IssueCreated`) into beautifully formatted Discord Embeds with colors and fields.",
        "models.md": "# Discord Service Models\n\n## Domain Models\n- `DiscordGuildConfig`: Configuration for channel mapping per project.\n\n## DTOs\n- `NotificationPayload`: Internal request to send a message (contains title, description, color, url).",
        "database.md": "# Discord Service Database\n\n## Schema\n- `discord_channels`: Maps Jira Project Keys to Discord Channel IDs.\n- `discord_user_mappings`: Maps Discord User IDs to JIDIS/Atlassian User IDs.\n\n## Caching\n- Guild and Channel configurations are cached in memory/Redis.",
        "dependencies.md": "# Discord Service Dependencies\n\n## Internal\n- None directly, acts as a consumer of message broker events.\n\n## External NPM\n- `discord.js`\n- `dotenv`",
        "views.md": "# Discord Service Views\n\n## Views / Output\nGenerates Discord Rich Embeds.\n\n```json\n{\n  \"embeds\": [{\n    \"title\": \"Issue Created: PROJ-123\",\n    \"color\": 3447003,\n    \"description\": \"Bug in the login flow\"\n  }]\n}\n```"
    },
    "storage-service": {
        "README.md": "# Storage Service\n\n## Overview\nThe Storage Service provides unified file and blob management for JIDIS, supporting local storage and cloud providers like AWS S3.\n\n## Responsibilities\n- Secure file uploads and downloads.\n- Generating presigned URLs.\n- Image optimization and resizing.\n- Virus scanning for attachments.",
        "routes.md": "# Storage Service Routes\n\n## Endpoints\n- `POST /api/v1/storage/upload`: Upload a file.\n- `GET /api/v1/storage/download/:id`: Download a file.\n- `GET /api/v1/storage/presigned-upload`: Get a presigned URL for direct upload.",
        "controllers.md": "# Storage Service Controllers\n\n## FileController\n- `upload`: Handles multipart/form-data, streams to storage provider.\n- `download`: Pipes file stream to HTTP response.\n- `generatePresigned`: Returns temporary URLs.",
        "services.md": "# Storage Service Business Logic\n\n## S3ProviderService\n- Implements AWS S3 SDK for file operations.\n\n## LocalProviderService\n- Fallback for local development using the local filesystem.\n\n## OptimizationService\n- Uses Sharp to compress images before storing them.",
        "models.md": "# Storage Service Models\n\n## Domain Models\n- `FileMetadata`: Stores original name, mime type, size, and storage path.\n\n## DTOs\n- `UploadResponseDTO`: Contains file ID and public URL.",
        "database.md": "# Storage Service Database\n\n## Schema\n- `files`: Table storing `id`, `filename`, `mime_type`, `size`, `provider`, `path`, `created_at`.\n\n## Caching\n- Presigned URLs are temporarily cached if requested multiple times within the TTL.",
        "dependencies.md": "# Storage Service Dependencies\n\n## Internal\n- Shared auth middleware to verify upload permissions.\n\n## External NPM\n- `multer`\n- `@aws-sdk/client-s3`\n- `sharp`\n- `uuid`",
        "views.md": "# Storage Service Views\n\n## API Responses\n```json\n{\n  \"file_id\": \"uuid-1234\",\n  \"url\": \"https://s3.bucket/path/to/file.png\"\n}\n```"
    },
    "electron-desktop": {
        "README.md": "# Electron Desktop\n\n## Overview\nThe Electron Desktop application is the primary client interface for JIDIS. It provides a native-feeling experience for developers to interact with Jira, GitHub, and Discord data all in one unified dashboard.\n\n## Responsibilities\n- Interfacing with the OS (notifications, tray icon, shortcuts).\n- Rendering the React/Vue frontend.\n- Managing local desktop state and IPC communication.",
        "routes.md": "# Electron Desktop IPC Routes\n\n## IPC Channels (Main <-> Renderer)\n- `ipcMain.handle('system:notify')`: Trigger OS notification.\n- `ipcMain.handle('auth:login')`: Open OAuth window.\n- `ipcMain.handle('config:get')`: Read local config file.\n- `ipcMain.handle('graphql:query')`: Forward GraphQL request to BFF.",
        "controllers.md": "# Electron Desktop Controllers\n\n## IPC Controllers (Main Process)\n- `SystemController`: Handles window management, tray, and OS-level tasks.\n- `AuthController`: Manages secure storage of auth tokens (using Keytar or similar).\n- `NetworkController`: Wraps fetch calls to the BFF GraphQL API.",
        "services.md": "# Electron Desktop Services\n\n## Main Process Services\n- `WindowManager`: Creates and manages `BrowserWindow` instances.\n- `TrayManager`: Manages the system tray icon and context menu.\n- `StoreService`: Uses `electron-store` for persisting user preferences locally.\n\n## Renderer Process Services\n- `ApolloClient`: Configured to talk to the BFF.\n- `StateManagement`: Zustand or Redux for frontend state.",
        "models.md": "# Electron Desktop Models\n\n## TypeScript Interfaces\n- `UserPreferences`: Theme, notification settings, layout configs.\n- `AppConfig`: Endpoint URLs and environment variables.\n\n## IPC Payloads\n- `NotifyPayload`: `{ title: string, body: string }`",
        "database.md": "# Electron Desktop Database\n\n## Local Storage\n- Uses `electron-store` (JSON file) for simple preferences.\n- Uses `IndexedDB` or `SQLite` (via native module) if large local caching (e.g., offline mode) is required.\n\n## Caching\n- Apollo Client in-memory cache for GraphQL requests.",
        "dependencies.md": "# Electron Desktop Dependencies\n\n## External NPM\n- `electron`\n- `electron-builder`\n- `electron-store`\n- `react` / `vue` (Frontend)\n- `@apollo/client`",
        "views.md": "# Electron Desktop Views\n\n## UI Components (Renderer)\n- `Dashboard`: Main grid view of issues and PRs.\n- `IssueDetail`: Modal or pane showing Jira issue + GitHub context.\n- `Settings`: Preferences screen.\n- `Sidebar`: Navigation between modules.\n\nBuilt with modern CSS frameworks (Tailwind/MUI)."
    }
};

for (const [moduleName, files] of Object.entries(docs)) {
    const moduleDir = path.join(baseDir, moduleName);
    fs.mkdirSync(moduleDir, { recursive: true });
    
    for (const [fileName, content] of Object.entries(files)) {
        const filePath = path.join(moduleDir, fileName);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Created ${filePath}`);
    }
}
console.log("All docs generated successfully.");
