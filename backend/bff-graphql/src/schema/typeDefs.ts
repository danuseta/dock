import { gql } from 'graphql-tag';

export const typeDefs = gql`
  type Ticket {
    key: ID!
    title: String!
    description: String
    """The Jira Acceptance Criteria field as text, one line per item."""
    acceptanceCriteria: String
    userStory: String
    problemDefinition: String
    figmaUrl: String
    status: String!
    assignee: String
    url: String!
    projectKey: String
    projectName: String
    sprintName: String
    sprintState: String
    storyPoints: Float
    labels: [String!]!
    """Work order for the cron: the number set in DOCK, else the ticket's "#N" Jira label."""
    workOrder: Int
    """"dock" when the number was set in DOCK, "label" when it comes from a Jira label."""
    workOrderSource: String
    """True when the owner works the ticket by hand: the cron never takes or resumes it."""
    workManual: Boolean!
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
    hasDiscordBotToken: Boolean!
    "True when the bot token comes from the workspace template, not from these settings."
    discordManagedToken: Boolean!
    "The server id the workspace's team file gives, when these settings have none."
    discordManagedGuild: String
    "How many forums the workspace's team file brings."
    discordTeamChannels: Int!
    discordGuildId: String
    discordUserId: String
    autoReviewOnIt: Boolean!
    autoLgtm: Boolean!
    hasGoogleClientSecret: Boolean!
    googleCalendarConnected: Boolean!
    googleCalendarError: String
    serviceHealthRefreshSeconds: Int!
    hasMasterPin: Boolean
    chatDefaultModel: String
    chatDefaultEffort: String
    chatDefaultMode: String
    chatRtk: String!
    chatCaveman: String!
    """How many chat turns a bridge runs at once; null leaves it to the bridge's own file."""
    chatParallelTurns: String
    """JSON: the volume and, per event, whether it notifies and with which bundled sound."""
    notificationPrefs: String!
  }

  type DiscordAttachment {
    name: String!
    size: Int!
    type: String
    """A CDN link that works for at least the next hour."""
    url: String!
    width: Int
    height: Int
  }

  """A user or, with role, a server role named in a message."""
  type DiscordMention {
    id: ID!
    name: String!
    me: Boolean!
    role: Boolean!
  }

  type DiscordMessage {
    id: ID!
    author: String!
    avatar: String!
    mine: Boolean!
    at: String!
    text: String!
    mentions: [DiscordMention!]!
    attachments: [DiscordAttachment!]!
  }

  type DiscordClaim {
    author: String!
    mine: Boolean!
    at: String!
  }

  type DiscordThreadTicket {
    key: String!
    status: String
    assignee: String
    """The ticket's Jira sprint; null when it is in none."""
    sprint: String
    sprintActive: Boolean!
  }

  """A Discord channel the owner follows, or one thread followed on its own. kind is bug, uat, pr or follow."""
  type DiscordChannel {
    id: ID!
    """Null until the bot has read it."""
    name: String
    kind: String!
    thread: Boolean!
    enabled: Boolean!
    """Brought by the workspace's team file: it can be switched off, not removed."""
    team: Boolean!
  }

  """A thread of a followed channel, as the Discord reader sorted it."""
  type DiscordThread {
    id: ID!
    channelId: ID!
    channel: String!
    kind: String!
    title: String!
    url: String!
    state: String!
    why: String!
    needsYou: Boolean!
    """Needs the owner but has been quiet for three days."""
    older: Boolean!
    dismissed: Boolean!
    createdBy: String
    """The avatar of whoever opened the thread."""
    createdByAvatar: String
    createdAt: String!
    lastActivity: String!
    messageCount: Int!
    tags: [String!]!
    """Reviewers a pull request asks for, from "-1" or "-2" in its first message or tags; two otherwise."""
    slots: Int!
    tickets: [DiscordThreadTicket!]!
    prs: [String!]!
    claim: DiscordClaim
    """Everyone who said on it; in a PR thread the author of the pull request is left out."""
    onIt: [String!]!
    """The Jira Pass labels of the thread's tickets, such as alvinPass."""
    passes: [String!]!
    claimerRepliedAt: String
    mentionedAt: String
    repliedAt: String
    messages: [DiscordMessage!]!
  }

  type DiscordThreads {
    configured: Boolean!
    """The owner's Discord user id is set, so threads that are theirs can be told apart."""
    ownerSet: Boolean!
    """The Gateway is connected, so Discord pushes changes as they happen."""
    live: Boolean!
    syncedAt: String
    error: String
    channels: [DiscordChannel!]!
    rows: [DiscordThread!]!
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
    since: String
    until: String
  }

  """One stop of the rail in one round: when the run was there, and who worked on it."""
  type TimelineVisit {
    stageIndex: Int!
    round: Int!
    from: String
    to: String
    agents: [TimelineAgent!]!
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
    """The run stopped at GATE 1 (a manual run), so the rail starts with a Gate stop."""
    hasGate: Boolean!
    gates: [TimelineGate!]!
    agents: [TimelineAgent!]!
    visits: [TimelineVisit!]!
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
    n: Int
    at: String!
    text: String!
    status: String
    by: String
    issue: Int
    cancelNote: String
    """What choosing this decision changes, as sous wrote it."""
    effect: String
    """The options sous did not build, each with what it would change instead."""
    alts: [OrchestrationDecisionAlt!]!
    replaces: Int
    supersededBy: Int
  }

  type OrchestrationDecisionAlt {
    label: String!
    effect: String
  }

  type OrchestrationIssue {
    n: Int!
    at: String!
    type: String!
    text: String!
    level: String!
    status: String!
    resolvedBy: Int
    resolvedAt: String
    options: [String!]!
    """What choosing each option changes, in the order of options."""
    effects: [String]!
  }

  type OrchestrationStackRepo {
    pr: String!
    branch: String
    base: String
    retargetedAt: String
  }

  type OrchestrationStack {
    key: String!
    be: OrchestrationStackRepo
    fe: OrchestrationStackRepo
  }

  type OrchestrationRounds {
    used: Int!
    max: Int!
  }

  type ApprovalStep {
    name: String!
    ok: Boolean!
    detail: String!
  }

  type ClaudeUsageTotals {
    inputTokens: Float!
    outputTokens: Float!
    cacheCreationTokens: Float!
    cacheReadTokens: Float!
    totalTokens: Float!
    cost: Float!
  }

  type ClaudeUsageDay {
    date: String!
    totalTokens: Float!
    cost: Float!
  }

  type ClaudeUsageModel {
    model: String!
    inputTokens: Float!
    outputTokens: Float!
    cacheCreationTokens: Float!
    cacheReadTokens: Float!
    totalTokens: Float!
    cost: Float!
  }

  type ClaudeUsage {
    available: Boolean!
    totals: ClaudeUsageTotals
    days: [ClaudeUsageDay!]!
    models: [ClaudeUsageModel!]!
    error: String
  }

  type DoctorCheck {
    name: String!
    ok: Boolean!
    detail: String
  }

  type DoctorReport {
    machine: String!
    host: String!
    os: String!
    at: String!
    receivedAt: String!
    kitVersion: String
    checks: [DoctorCheck!]!
  }

  type AgentLook {
    slug: String!
    displayName: String
    initials: String
    color: String
    avatarUrl: String
  }

  input AgentLookInput {
    slug: String!
    displayName: String
    initials: String
    color: String
    removeAvatar: Boolean
  }

  type LibraryAgentLock {
    slug: Boolean!
    tools: Boolean!
    hooks: Boolean!
  }

  type LibraryAgent {
    slug: String!
    source: String!
    description: String!
    model: String!
    tools: [String!]!
    guardProfile: String
    hasHooks: Boolean!
    dispatchable: Boolean!
    locked: LibraryAgentLock!
  }

  type LibraryAgentDetail {
    slug: String!
    source: String!
    description: String!
    model: String!
    tools: [String!]!
    guardProfile: String
    hasHooks: Boolean!
    dispatchable: Boolean!
    locked: LibraryAgentLock!
    body: String!
    hooksText: String!
    kitBody: String
  }

  type LibraryAgentCheck {
    ok: Boolean!
    text: String!
  }

  type LibraryAgentPreview {
    diff: String!
    checks: [LibraryAgentCheck!]!
  }

  type LibraryAgentSave {
    ok: Boolean!
    diff: String!
    error: String
  }

  input LibraryAgentInput {
    slug: String!
    create: Boolean!
    description: String!
    model: String!
    tools: [String!]!
    body: String!
    guardProfile: String
    dispatchable: Boolean!
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

  type DemoVideo {
    ticketKey: String!
    url: String!
    size: Float
    updatedAt: String
    """The ticket's Jira title when it is among the assigned tickets DOCK already fetched."""
    title: String
  }

  type DemoStorage {
    configured: Boolean!
    endpoint: String!
    region: String!
    bucket: String!
    folder: String!
    publicBaseUrl: String!
    accessKeyMasked: String
    secretSet: Boolean!
  }

  input DemoStorageInput {
    endpoint: String
    region: String
    bucket: String
    folder: String
    publicBaseUrl: String
    accessKey: String
    secretKey: String
  }

  type DemoVideoList {
    configured: Boolean!
    videos: [DemoVideo!]!
  }

  enum DevServerState {
    running
    starting
    stopped
    failed
  }

  type DevServer {
    name: String!
    folder: String!
    port: Int!
    running: Boolean!
    pid: Int
    state: DevServerState!
    error: String
    ticketKey: String
    hasLog: Boolean!
  }

  type DevServerAction {
    at: String!
    target: String!
    action: String!
    ok: Boolean!
    output: String!
  }

  type DevServers {
    main: [DevServer!]!
    secondary: [DevServer!]!
    actions: [DevServerAction!]!
  }

  type ElevenLabsKey {
    name: String!
    masked: String!
    parkedUntil: String
    current: Boolean!
  }

  type ElevenLabsQuota {
    name: String!
    characterCount: Int
    characterLimit: Int
    resetsAt: String
    hidden: Boolean!
    error: String
  }

  type OrchestrationClosing {
    hours: Float
    fixRounds: Int!
    replans: Int!
  }

  type OrchestrationFinding {
    at: String!
    severity: String!
    text: String!
    resolvedAt: String
    resolvedWhy: String
  }

  type OrchestrationLgtm {
    at: String!
    text: String!
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
    findings: [OrchestrationFinding!]!
    lgtm: [OrchestrationLgtm!]!
    verdict: String
    engine: String
    rounds: OrchestrationRounds
    stackedOn: OrchestrationStack
    productionData: Boolean
    draft: Boolean
    issues: [OrchestrationIssue!]!
    """Every step of the owner's last review approval succeeded (Jira Pass label and GitHub approve)."""
    approved: Boolean!
    """The guessed decisions (SHOV, USULAN) the owner confirmed in DOCK."""
    confirmedDecisions: [Int!]!
    blockers: Int!
    activity: String!
    activityDetail: String
    idleSeconds: Int!
    endedSeconds: Float
    stalled: Boolean!
    hasTranscript: Boolean!
    machine: String!
    updatedAt: String!
    events: [OrchestrationEvent!]!
    timeline: OrchestrationTimeline
    members: [TimelineAgent!]!
  }

  type IngestToken {
    id: ID!
    name: String!
    prefix: String!
    machine: String!
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
    machine: String!
    status: String!
    statusDetail: String
    messageCount: Int!
    startedAt: String!
    lastMessageAt: String!
    lastText: String
    waiting: Boolean!
    workerCount: Int!
    pending: [ChatInteraction!]!
    settled: [ChatSettled!]!
    options: ChatTurnOptions
  }

  type ChatSessionState {
    id: ID!
    title: String!
    status: String!
    statusDetail: String
    origin: String!
    ticketKey: String
  }

  type ChatWorker {
    id: String!
    parentId: String
    turnId: Int!
    name: String!
    label: String!
    status: String!
    startedAt: String!
    endedAt: String
  }

  type ChatMessage {
    id: Int!
    sessionId: ID!
    role: String!
    text: String!
    state: String!
    at: String!
    stopped: Boolean!
    attachments: [ChatAttachment!]!
  }

  type ChatSettled {
    id: Int!
    state: String!
    decision: String
  }

  type ChatInteraction {
    id: Int!
    sessionId: ID!
    turnId: Int!
    kind: String!
    title: String!
    body: String!
    state: String!
    createdAt: String!
    expiresAt: String!
    answeredAt: String
  }

  type ChatAttachment {
    id: ID!
    name: String!
    mime: String!
    size: Int!
    state: String!
  }

  type ChatTurnOptions {
    model: String
    effort: String
    permissionMode: String
    fast: Boolean
  }

  type ChatCommand {
    name: String!
    description: String!
    argumentHint: String!
    kind: String!
  }

  type ChatModel {
    value: String!
    label: String!
    efforts: [String!]!
    fast: Boolean!    auto: Boolean!
  }

  type ChatMachineDefaults {
    model: String
    effort: String
    permissionMode: String
  }

  type ChatMachineOptions {
    models: [ChatModel!]!
    modes: [String!]!
    fastAvailable: Boolean!
    defaults: ChatMachineDefaults!
  }

  input ChatTurnOptionsInput {
    model: String
    effort: String
    permissionMode: String
    fast: Boolean
  }

  input ChatAnswerInput {
    index: Int!
    labels: [String!]!
    other: String
  }

  input IssueAnswerInput {
    issue: Int!
    text: String!
  }

  input DecisionChangeInput {
    n: Int!
    choice: String!
  }

  type ChatActivity {
    id: Int!
    sessionId: ID!
    turnId: Int!
    eventId: String!
    parentId: String
    kind: String!
    agent: String!
    name: String!
    label: String!
    summary: String!
    status: String!
    hasDetail: Boolean!
    seq: Int!
    startedAt: String!
    endedAt: String
  }

  type ChatBridge {
    online: Boolean!
    lastSeenAt: String
  }

  type ChatMachine {
    name: String!
    online: Boolean!
    lastSeenAt: String
    capabilities: [String!]!
    claudeVersion: String
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

  type ChatFileChange {
    path: String!
    added: Int!
    removed: Int!
  }

  type ChatSessionStatus {
    sessionId: ID!
    machine: String
    model: String
    effort: String
    fastMode: Boolean
    contextPercentage: Float
    contextTokens: Float
    contextSize: Float
    costUsd: Float
    cacheWarm: Boolean
    cacheHitRatio: Float
    files: [ChatFileChange!]!
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
    discordBotToken: String
    discordGuildId: String
    discordUserId: String
    autoReviewOnIt: String
    autoLgtm: String
    googleClientId: String
    googleClientSecret: String
    googleCalendarId: String
    serviceHealthRefreshSeconds: Int
    chatDefaultModel: String
    chatDefaultEffort: String
    chatDefaultMode: String
    chatRtk: String
    chatCaveman: String
    chatParallelTurns: String
    notificationPrefs: String
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

  type OrchestratorCronSettings {
    config: String!
    lastFill: String!
  }

  type DockIssueAuthor {
    login: String!
    avatarUrl: String!
  }

  type DockIssue {
    number: Int!
    title: String!
    state: String!
    author: DockIssueAuthor!
    createdAt: String!
    updatedAt: String!
    comments: Int!
    url: String!
    body: String!
  }

  type DockIssueComment {
    id: ID!
    author: DockIssueAuthor!
    createdAt: String!
    body: String!
  }

  type DockIssueDetail {
    number: Int!
    title: String!
    state: String!
    author: DockIssueAuthor!
    createdAt: String!
    updatedAt: String!
    comments: Int!
    url: String!
    body: String!
    commentList: [DockIssueComment!]!
  }

  type DockIssueList {
    tokenMissing: Boolean!
    viewer: String
    issues: [DockIssue!]!
  }

  type PostedDockIssue {
    number: Int!
    url: String!
  }

  enum DockIssueFilter {
    OPEN
    CLOSED
    MINE
  }

  "A review DOCK started when the owner said on it in a pr-review thread."
  type AutoReview {
    id: ID!
    ticketKey: String!
    prUrl: String!
    headSha: String!
    threadUrl: String!
    sessionId: String
    status: String!
    detail: String
    startedAt: String!
    finishedAt: String
  }

  type ClaudeUsageWindow {
    usedPercentage: Float!
    resetsAt: String
  }

  "One account of /cycle on this machine, with the last usage seen while it was in use."
  type ClaudeAccount {
    name: String!
    active: Boolean!
    fiveHour: ClaudeUsageWindow
    sevenDay: ClaudeUsageWindow
    seenAt: String
  }

  type ClaudeRotation {
    enabled: Boolean!
    fiveHour: Int!
    sevenDay: Int!
    backToMain: Boolean!
  }

  type ClaudeRotationEntry {
    at: String!
    from: String!
    to: String!
    reason: String!
    auto: Boolean!
  }

  type ClaudeAccounts {
    "False when this machine has no /cycle: a laptop DOCK, or a workspace without it."
    available: Boolean!
    accounts: [ClaudeAccount!]!
    rotation: ClaudeRotation!
    log: [ClaudeRotationEntry!]!
  }

  type Query {
    authStatus: AuthStatus!
    dockMode: String!
    ownerName: String!
    dashboard: [TicketGroup!]!
    ticketDetail(key: String!): Ticket
    ticketRelationGroup(ticketKey: String!): TicketRelationGroup!
    needsAttention: [NeedsAttentionItem!]!
    discordThreads: DiscordThreads!
    autoReviews: [AutoReview!]!
    claudeAccounts: ClaudeAccounts!
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
    doctorReports: [DoctorReport!]!
    claudeUsage(from: String!, to: String!): ClaudeUsage!
    agentLooks: [AgentLook!]!
    libraryAgents(machine: String): [LibraryAgent!]!
    libraryAgent(slug: String!, machine: String): LibraryAgentDetail!
    demoVideos: DemoVideoList!
    demoStorage: DemoStorage!
    devServers: DevServers!
    devServerLog(name: String!, bytes: Int): String!
    elevenLabsKeys: [ElevenLabsKey!]!
    elevenLabsQuota: [ElevenLabsQuota!]!
    chatSessions(source: String, limit: Int): [ChatSession!]!
    chatSession(id: ID!): ChatSession
    chatSessionStates(limit: Int): [ChatSessionState!]!
    chatMessages(sessionId: ID!, afterId: Int, beforeId: Int, limit: Int): [ChatMessage!]!
    chatActivity(sessionId: ID!, afterSeq: Int, fromTurnId: Int, beforeTurnId: Int, limit: Int): [ChatActivity!]!
    chatSessionWorkers(sessionId: ID!): [ChatWorker!]!
    chatActivityDetail(sessionId: ID!, id: Int!): String
    chatSearch(query: String!, limit: Int): [ChatSearchHit!]!
    chatBridge: ChatBridge!
    chatMachines: [ChatMachine!]!
    chatStatus(machine: String): ChatStatus!
    chatBalloons: [ChatMessage!]!
    chatCommands(machine: String!, query: String, limit: Int): [ChatCommand!]!
    chatMachineOptions(machine: String!): ChatMachineOptions
    sprintList: [SprintSummary!]!
    sprintDashboard(sprintId: Int): SprintDashboard!
    sprintTrend: String!
    sprintIssueEvents(sprintId: Int!): String!
    sprintDashboardSettings: SprintDashboardSettings!
    orchestratorCronSettings: OrchestratorCronSettings!
    """JSON: cron slots in use, today's count against the cap, and the last fill (started, parked, deferred)."""
    orchestratorCronStatus: String!
    pushPublicKey: String!
    dockBuild: String!
    dockIssues(filter: DockIssueFilter!): DockIssueList!
    dockIssue(number: Int!): DockIssueDetail
    """The GitHub new-issue address filled with the same title and body that reportDockIssue posts."""
    dockIssueDraftUrl(title: String!, happened: String!, steps: String, expected: String, imageLinks: [String!], page: String!): String!
  }

  type Mutation {
    lockSession: Boolean!
    saveDemoLink(ticketKey: String!, url: String!): Boolean
    sendToDiscord(ticketKey: String!, customMessage: String, threadId: String, threadName: String): Boolean
    setTicketDependency(ticketKey: String!, dependsOnKey: String!): TicketRelationGroup!
    clearTicketDependency(ticketKey: String!): TicketRelationGroup!
    setTicketWorkOrder(ticketKey: String!, position: Int!): Boolean!
    clearTicketWorkOrder(ticketKey: String!): Boolean!
    setTicketManual(ticketKey: String!, manual: Boolean!): Boolean!
    updateSettings(input: SettingsInput!): Boolean
    validateJira(url: String, email: String, token: String): ValidationResult
    validateGitHub(token: String): ValidationResult
    validateDiscord(webhookUrl: String): ValidationResult
    testDiscordReader: ValidationResult!
    refreshDiscord: DiscordThreads!
    """Hides the thread until a message newer than lastActivity arrives."""
    dismissDiscordThread(id: ID!, lastActivity: String!): Boolean!
    """Follows a channel or a thread from its id or a discord.com/channels link."""
    addDiscordChannel(input: String!, kind: String!): DiscordThreads!
    updateDiscordChannel(id: ID!, kind: String!, enabled: Boolean!): DiscordThreads!
    removeDiscordChannel(id: ID!): DiscordThreads!
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
    createIngestToken(name: String!, machine: String): IngestTokenSecret!
    revokeIngestToken(id: ID!): Boolean!
    deleteDemoVideo(ticketKey: String!): Boolean!
    saveDemoStorage(input: DemoStorageInput!): DemoStorage!
    clearDemoStorage: Boolean!
    startDevServer(name: String!): Boolean!
    stopDevServer(name: String!): Boolean!
    restartDevServer(name: String!): Boolean!
    startAllDevServers: Boolean!
    stopAllDevServers: Boolean!
    stopWorktreeServer(port: Int!): Boolean!
    addElevenLabsKey(name: String!, key: String!): Boolean!
    removeElevenLabsKey(name: String!): Boolean!
    unparkElevenLabsKey(name: String!): Boolean!
    dismissOrchestration(key: String!): Boolean!
    createChatSession(title: String, ticketKey: String, forkFrom: ID, machine: String): ChatSession!
    sendChatMessage(sessionId: ID!, text: String!, attachmentIds: [ID!], options: ChatTurnOptionsInput, mode: String): ChatMessage!
    answerChatInteraction(sessionId: ID!, id: Int!, decision: String!, answers: [ChatAnswerInput!], note: String): ChatInteraction!
    answerTicket(ticketKey: String!, text: String!, issue: Int): Boolean!
    """
    The owner's answer sheet for one ticket: confirmations are recorded (no session), answers and changes go to one new sous session.
    A build with nothing left for the owner has its draft PRs marked ready. Returns the confirmed decisions.
    """
    submitDecisions(ticketKey: String!, answers: [IssueAnswerInput!]!, changes: [DecisionChangeInput!]!, confirms: [Int!]!): [Int!]!
    approveReview(ticketKey: String!): [ApprovalStep!]!
    useClaudeAccount(name: String!): ClaudeAccounts!
    setClaudeRotation(enabled: Boolean!, fiveHour: Int!, sevenDay: Int!, backToMain: Boolean!): ClaudeAccounts!
    stopChatTurn(sessionId: ID!): ChatSession!
    requestDoctorRun(machine: String!): Boolean!
    saveAgentLook(input: AgentLookInput!): AgentLook!
    previewLibraryAgent(input: LibraryAgentInput!, machine: String): LibraryAgentPreview!
    saveLibraryAgent(input: LibraryAgentInput!, machine: String): LibraryAgentSave!
    deleteLibraryAgent(slug: String!, machine: String): LibraryAgentSave!
    renameChatSession(id: ID!, title: String!): ChatSession!
    setChatSessionOptions(id: ID!, options: ChatTurnOptionsInput!): ChatSession!
    deleteChatSession(id: ID!): Boolean!
    refreshSprintDashboard(sprintId: Int!): SprintRefreshState!
    backfillSprintDashboards(count: Int!): SprintRefreshState!
    updateSprintDashboardSettings(boardId: String!, config: String!): Boolean!
    updateOrchestratorCronSettings(config: String!): Boolean!
    runOrchestratorCronNow: String!
    confirmOrchestration(key: String!): Boolean!
    stopAllAgents: Int!
    subscribePush(endpoint: String!, p256dh: String!, auth: String!): Boolean!
    unsubscribePush(endpoint: String!): Boolean!
    sendTestPush: Int!
    reportDockIssue(title: String!, happened: String!, steps: String, expected: String, imageLinks: [String!], page: String!): PostedDockIssue!
  }
`;
