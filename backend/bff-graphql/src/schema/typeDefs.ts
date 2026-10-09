import { gql } from 'graphql-tag';

export const typeDefs = gql`
  type Ticket {
    key: ID!
    title: String!
    description: String
    status: String!
    assignee: String
    url: String!
    projectKey: String
    projectName: String
    sprintName: String
    sprintState: String
    storyPoints: Float
    labels: [String!]!
    pullRequests: [PullRequest!]
    demoLink: DemoLink
    orchestration: Orchestration
  }

  type TicketGroup {
    status: String!
    tickets: [Ticket!]!
  }

  type TicketRelationGroup {
    primaryKey: String!
    dependsOnKey: String
    ticketKeys: [String!]!
    tickets: [Ticket!]!
  }

  type CommitInfo {
    sha: String!
    author: String
    message: String!
    date: String
    url: String
  }

  type FileInfo {
    filename: String!
    status: String
    additions: Int
    deletions: Int
    changes: Int
    blobUrl: String
  }

  type PullRequest {
    id: ID!
    title: String!
    url: String!
    status: String!
    repo: String!
    type: String!
    owner: String!
    pullNumber: Int!
    baseBranch: String
    headBranch: String
    commitsCount: Int
    commits: [CommitInfo!]
    changedFilesCount: Int
    files: [FileInfo!]
  }

  type ConflictDetail {
    hasConflict: Boolean!
    message: String
  }

  type DemoLink {
    url: String!
    updatedAt: String!
  }

  type QuickLink {
    id: ID!
    title: String!
    url: String!
    color: String!
    position: Int!
  }

  type CalendarEvent {
    id: ID!
    title: String!
    start: String!
    end: String
    allDay: Boolean!
    location: String
    url: String
    calendarId: String
  }

  type MonitorTarget {
    id: ID!
    name: String!
    url: String!
    expectedStatus: Int!
    timeoutMs: Int!
    lastStatus: String
    lastStatusCode: Int
    lastLatencyMs: Int
    lastCheckedAt: String
    lastError: String
  }

  type DockerContainer {
    id: ID!
    name: String!
    project: String
    image: String!
    command: String
    state: String!
    status: String!
    ports: [String!]!
    createdAt: String!
    uptime: String!
    cpuPercent: Float
    memoryUsageBytes: Float
    memoryLimitBytes: Float
    memoryPercent: Float
  }

  type DockerRuntime {
    available: Boolean!
    engineVersion: String
    serverName: String
    total: Int!
    running: Int!
    stopped: Int!
    images: Int!
    containers: [DockerContainer!]!
    refreshedAt: String!
    error: String
  }

  type Settings {
    jiraUrl: String
    jiraEmail: String
    jiraProjectKeys: String
    githubRepos: String
    googleClientId: String
    googleCalendarId: String
    hasJiraApiToken: Boolean!
    hasGithubToken: Boolean!
    hasDiscordWebhookUrl: Boolean!
    discordMessageTemplate: String!
    hasGoogleClientSecret: Boolean!
    googleCalendarConnected: Boolean!
    serviceHealthRefreshSeconds: Int!
    hasMasterPin: Boolean
  }

  type ValidationResult {
    success: Boolean!
    message: String!
  }

  type AuthStatus {
    authenticated: Boolean!
    hasMasterPin: Boolean!
  }

  type NeedsAttentionItem {
    id: ID!
    type: String!
    message: String!
    ticketKey: String
    prUrl: String
    owner: String
    repo: String
    pullNumber: Int
  }

  type OrchestrationAc {
    n: Int!
    state: String!
    text: String!
    evidence: String
  }

  type OrchestrationEvent {
    id: ID!
    kind: String!
    detail: String
    at: String!
  }

  type TimelineGate {
    id: ID!
    stageIndex: Int!
    text: String!
    state: String!
    at: String!
  }

  type TimelineAgent {
    id: ID!
    parentId: ID
    name: String!
    detail: String
    state: String!
    tool: String
    tools: Int!
  }

  type TimelineBucket {
    n: Int!
    gate: Boolean!
  }

  type TimelineLogEntry {
    at: String!
    kind: String!
    head: String!
    text: String!
  }

  type OrchestrationTimeline {
    stageIndex: Int!
    round: Int!
    loopFrom: Int
    loopTo: Int
    gates: [TimelineGate!]!
    agents: [TimelineAgent!]!
    buckets: [TimelineBucket!]!
    totalTools: Int!
    log: [TimelineLogEntry!]!
  }

  type OrchestrationPullRequest {
    url: String!
    number: Int!
    repo: String!
    status: String!
    reviewDecision: String
    checks: String
  }

  type OrchestrationDecision {
    at: String!
    text: String!
  }

  type OrchestrationAssumption {
    n: Int!
    text: String!
    falsifier: String!
    state: String!
    evidence: String
  }

  type OrchestrationFailure {
    at: String!
    type: String!
    what: String
    evidence: String!
    attempt: Int!
  }

  type OrchestrationClosing {
    hours: Float
    fixRounds: Int!
    replans: Int!
  }

  type Orchestration {
    key: ID!
    kind: String!
    title: String!
    stage: String!
    waiting: String
    gate: String
    ac: [OrchestrationAc!]!
    acPassed: Int!
    acFailed: Int!
    acTotal: Int!
    testsBe: String
    testsFe: String
    prBe: String
    prFe: String
    pullRequests: [OrchestrationPullRequest!]!
    review: String
    reviewSignal: String
    finished: Boolean!
    note: String
    brief: String
    decisions: [OrchestrationDecision!]!
    assumptions: [OrchestrationAssumption!]!
    failures: [OrchestrationFailure!]!
    closing: OrchestrationClosing
    activity: String!
    activityDetail: String
    idleSeconds: Int!
    endedSeconds: Float
    stalled: Boolean!
    hasTranscript: Boolean!
    updatedAt: String!
    events: [OrchestrationEvent!]!
    timeline: OrchestrationTimeline
    members: [TimelineAgent!]!
  }

  type IngestToken {
    id: ID!
    name: String!
    prefix: String!
    createdAt: String!
    lastUsedAt: String
  }

  type IngestTokenSecret {
    token: String!
    record: IngestToken!
  }

  type ChatSession {
    id: ID!
    source: String!
    title: String!
    ticketKey: String
    forkFrom: String
    status: String!
    statusDetail: String
    messageCount: Int!
    startedAt: String!
    lastMessageAt: String!
    lastText: String
  }

  type ChatMessage {
    id: Int!
    sessionId: ID!
    role: String!
    text: String!
    state: String!
    at: String!
  }

  type ChatBridge {
    online: Boolean!
    lastSeenAt: String
  }

  type ChatLimit {
    usedPercentage: Float!
    resetsAt: String
  }

  type ChatLimits {
    fiveHour: ChatLimit
    sevenDay: ChatLimit
    receivedAt: String!
    stale: Boolean!
  }

  type ChatSessionStatus {
    sessionId: ID!
    model: String
    effort: String
    fastMode: Boolean
    contextPercentage: Float
    contextTokens: Float
    contextSize: Float
    costUsd: Float
    cacheWarm: Boolean
    cacheHitRatio: Float
    receivedAt: String!
    stale: Boolean!
  }

  type ChatStatus {
    limits: ChatLimits
    sessions: [ChatSessionStatus!]!
  }

  type ChatSearchHit {
    session: ChatSession!
    messageId: Int!
    snippet: String!
    at: String!
  }

  type GitHubRepo {
    id: ID!
    name: String!
    fullName: String!
    private: Boolean!
    url: String!
    description: String
  }

  type JiraProject {
    id: ID!
    key: String!
    name: String!
  }

  input SettingsInput {
    jiraUrl: String
    jiraEmail: String
    jiraApiToken: String
    jiraProjectKeys: String
    githubToken: String
    githubRepos: String
    discordWebhookUrl: String
    discordMessageTemplate: String
    googleClientId: String
    googleClientSecret: String
    googleCalendarId: String
    serviceHealthRefreshSeconds: Int
  }

  input QuickLinkInput {
    title: String!
    url: String!
    color: String
  }

  input MonitorTargetInput {
    name: String!
    url: String!
    expectedStatus: Int
    timeoutMs: Int
  }

  type SprintSummary {
    id: Int!
    name: String!
    state: String!
    startDate: String!
    endDate: String!
    computedAt: String
    lastError: String
  }

  type SprintRefreshState {
    status: String!
    label: String!
    done: Int!
    total: Int!
    error: String
  }

  type SprintDashboard {
    summary: SprintSummary
    result: String
    refreshState: SprintRefreshState!
  }

  type SprintDashboardSettings {
    boardId: String!
    config: String!
  }

  type Query {
    authStatus: AuthStatus!
    dashboard: [TicketGroup!]!
    ticketDetail(key: String!): Ticket
    ticketRelationGroup(ticketKey: String!): TicketRelationGroup!
    needsAttention: [NeedsAttentionItem!]!
    settings: Settings
    jiraProjects(url: String, email: String, token: String): [JiraProject!]!
    githubRepos(token: String): [GitHubRepo!]!
    quickLinks: [QuickLink!]!
    calendarEvents(timeMin: String, timeMax: String, maxResults: Int): [CalendarEvent!]!
    monitors(refresh: Boolean = false): [MonitorTarget!]!
    dockerRuntime(includeStats: Boolean = false): DockerRuntime!
    dockerContainerLogs(id: ID!, tail: Int = 100): String!
    orchestrations: [Orchestration!]!
    orchestration(key: String!): Orchestration
    ingestTokens: [IngestToken!]!
    chatSessions(source: String, limit: Int): [ChatSession!]!
    chatSession(id: ID!): ChatSession
    chatMessages(sessionId: ID!, afterId: Int, beforeId: Int, limit: Int): [ChatMessage!]!
    chatSearch(query: String!, limit: Int): [ChatSearchHit!]!
    chatBridge: ChatBridge!
    chatStatus: ChatStatus!
    chatBalloons: [ChatMessage!]!
    sprintList: [SprintSummary!]!
    sprintDashboard(sprintId: Int): SprintDashboard!
    sprintTrend: String!
    sprintIssueEvents(sprintId: Int!): String!
    sprintDashboardSettings: SprintDashboardSettings!
  }

  type Mutation {
    lockSession: Boolean!
    saveDemoLink(ticketKey: String!, url: String!): Boolean
    sendToDiscord(ticketKey: String!, customMessage: String, threadId: String, threadName: String): Boolean
    setTicketDependency(ticketKey: String!, dependsOnKey: String!): TicketRelationGroup!
    clearTicketDependency(ticketKey: String!): TicketRelationGroup!
    updateSettings(input: SettingsInput!): Boolean
    validateJira(url: String, email: String, token: String): ValidationResult
    validateGitHub(token: String): ValidationResult
    validateDiscord(webhookUrl: String): ValidationResult
    setMasterPin(pin: String!): Boolean
    changeMasterPin(oldPin: String!, newPin: String!): Boolean
    verifyMasterPin(pin: String!): Boolean
    removeMasterPin(oldPin: String!): Boolean
    refreshData: Boolean
    checkConflicts(owner: String!, repo: String!, pullNumber: Int!): ConflictDetail
    addQuickLink(input: QuickLinkInput!): QuickLink!
    removeQuickLink(id: ID!): Boolean!
    disconnectGoogleCalendar: Boolean!
    addMonitor(input: MonitorTargetInput!): MonitorTarget!
    updateMonitor(id: ID!, input: MonitorTargetInput!): MonitorTarget!
    removeMonitor(id: ID!): Boolean!
    checkMonitors: [MonitorTarget!]!
    createIngestToken(name: String!): IngestTokenSecret!
    revokeIngestToken(id: ID!): Boolean!
    dismissOrchestration(key: String!): Boolean!
    createChatSession(title: String, ticketKey: String, forkFrom: ID): ChatSession!
    sendChatMessage(sessionId: ID!, text: String!): ChatMessage!
    renameChatSession(id: ID!, title: String!): ChatSession!
    deleteChatSession(id: ID!): Boolean!
    refreshSprintDashboard(sprintId: Int!): SprintRefreshState!
    backfillSprintDashboards(count: Int!): SprintRefreshState!
    updateSprintDashboardSettings(boardId: String!, config: String!): Boolean!
  }
`;
