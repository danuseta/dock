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
    pullRequests: [PullRequest!]
    demoLink: DemoLink
  }

  type TicketGroup {
    status: String!
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

  type Query {
    authStatus: AuthStatus!
    dashboard: [TicketGroup!]!
    ticketDetail(key: String!): Ticket
    needsAttention: [NeedsAttentionItem!]!
    settings: Settings
    jiraProjects(url: String, email: String, token: String): [JiraProject!]!
    githubRepos(token: String): [GitHubRepo!]!
    quickLinks: [QuickLink!]!
    calendarEvents(timeMin: String, timeMax: String, maxResults: Int): [CalendarEvent!]!
    monitors(refresh: Boolean = false): [MonitorTarget!]!
  }

  type Mutation {
    lockSession: Boolean!
    saveDemoLink(ticketKey: String!, url: String!): Boolean
    sendToDiscord(ticketKey: String!, customMessage: String, threadId: String, threadName: String): Boolean
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
  }
`;
