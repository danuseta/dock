import { gql } from '@apollo/client';

export const GET_AUTH_STATUS = gql`
  query GetAuthStatus {
    authStatus {
      authenticated
      hasMasterPin
    }
    dockMode
  }
`;

export const GET_DASHBOARD = gql`
  query GetDashboard {
    dashboard {
      status
      tickets {
        key
        title
        status
        assignee
        url
        sprintName
        sprintState
        storyPoints
        labels
        workOrder
        workOrderSource
        workManual
        acceptanceCriteria
        openToConfirm
        figmaUrl
        blockedBy
        orchestration {
          key
          machine
          kind
          stage
          waiting
          acPassed
          acFailed
          acTotal
          activity
          stalled
        }
      }
    }
  }
`;

export const GET_TICKET_DETAIL = gql`
  query GetTicketDetail($key: String!) {
    ticketDetail(key: $key) {
      key
      title
      description
      status
      assignee
      url
      sprintName
      sprintState
      storyPoints
      labels
      workOrder
      workOrderSource
      workManual
      pullRequests {
        id
        title
        url
        status
        repo
        type
        owner
        pullNumber
        baseBranch
        headBranch
        commitsCount
        commits {
          sha
          author
          message
          date
          url
        }
        changedFilesCount
        files {
          filename
          status
          additions
          deletions
          changes
          blobUrl
        }
      }
      demoLink {
        url
        updatedAt
      }
    }
    ticketRelationGroup(ticketKey: $key) {
      primaryKey
      dependsOnKey
      ticketKeys
      tickets {
        key
        title
        url
        pullRequests {
          id
          title
          url
          status
          repo
          type
        }
        demoLink { url }
      }
    }
    dashboard {
      tickets { key title status }
    }
    settings {
      discordMessageTemplate
      hasDiscordBotToken
      discordGuildId
    }
  }
`;

export const GET_TICKET_DETAIL_CORE = gql`
  query GetTicketDetailCore($key: String!) {
    ticketDetail(key: $key) {
      key
      title
      description
      acceptanceCriteria
      userStory
      problemDefinition
      figmaUrl
      reference
      openToConfirm
      developerContext
      blockedBy
      status
      assignee
      url
      sprintName
      sprintState
      storyPoints
      labels
      workOrder
      workOrderSource
      workManual
    }
    ticketRelationGroup(ticketKey: $key) {
      primaryKey
      dependsOnKey
      ticketKeys
    }
    dashboard {
      tickets { key title status sprintState }
    }
    settings {
      discordMessageTemplate
    }
  }
`;

export const GET_TICKET_DETAIL_ENRICHMENT = gql`
  query GetTicketDetailEnrichment($key: String!) {
    ticketDetail(key: $key) {
      key
      pullRequests {
        id
        title
        url
        status
        repo
        type
        owner
        pullNumber
        baseBranch
        headBranch
        commitsCount
        commits {
          sha
          author
          message
          date
          url
        }
        changedFilesCount
        files {
          filename
          status
          additions
          deletions
          changes
          blobUrl
        }
      }
      demoLink {
        url
        updatedAt
      }
    }
    ticketRelationGroup(ticketKey: $key) {
      primaryKey
      dependsOnKey
      ticketKeys
      tickets {
        key
        title
        url
        pullRequests {
          id
          title
          url
          status
          repo
          type
        }
        demoLink { url }
      }
    }
  }
`;

export const GET_NEEDS_ATTENTION = gql`
  query GetNeedsAttention {
    needsAttention {
      id
      type
      message
      ticketKey
      prUrl
      owner
      repo
      pullNumber
    }
  }
`;

/**
 * Just enough of each run to count what waits on the owner: the sidebar badge and the Home panel. The issues and
 * decisions ask for the same fields as ORCHESTRATION_FIELDS, so the two queries never overwrite each other's lists.
 */
export const GET_OWNER_QUESTIONS = gql`
  query GetOwnerQuestions {
    orchestrations {
      key
      kind
      title
      issues { n at type text level status resolvedBy resolvedAt options effects }
      decisions { n at text status by issue cancelNote effect alts { label effect } replaces supersededBy }
      confirmedDecisions
    }
  }
`;

export const GET_OWNER_NAME = gql`
  query GetOwnerName {
    ownerName
  }
`;

export const GET_SETTINGS = gql`
  query GetSettings {
    settings {
      jiraUrl
      jiraEmail
      jiraProjectKeys
      githubRepos
      googleClientId
      googleCalendarId
      hasJiraApiToken
      hasGithubToken
      hasDiscordWebhookUrl
      hasDiscordBotToken
      discordManagedToken
      discordManagedGuild
      discordTeamChannels
      discordGuildId
      discordUserId
      autoReviewOnIt
      autoLgtm
      reviewFindingsToTask
      discordMessageTemplate
      hasGoogleClientSecret
      googleCalendarConnected
      googleCalendarError
      serviceHealthRefreshSeconds
      hasMasterPin
      chatDefaultModel
      chatDefaultEffort
      chatDefaultMode
      chatRtk
      chatCaveman
      chatParallelTurns
      ownerReplySession
      notificationPrefs
      planningConfluenceParent
      planningPlanner
    }
  }
`;

export const GET_HOME = gql`
  query GetHome {
    quickLinks {
      id
      title
      url
      color
      position
    }
    dashboard {
      status
      tickets {
        key
        title
        status
        sprintName
        storyPoints
      }
    }
    needsAttention {
      id
      message
      ticketKey
    }
    calendarEvents(maxResults: 50) {
      id
      title
      start
      end
      allDay
      location
      url
      calendarId
    }
    monitors(refresh: true) {
      id
      name
      url
      lastStatus
      lastStatusCode
      lastLatencyMs
      lastCheckedAt
    }
    settings {
      serviceHealthRefreshSeconds
    }
    dockerRuntime {
      available
      total
      running
      stopped
      containers { id name image state uptime }
    }
  }
`;

export const GET_HOME_CORE = gql`
  query GetHomeCore {
    quickLinks {
      id
      title
      url
      color
      position
    }
    dashboard {
      status
      tickets {
        key
        title
        status
        sprintName
        storyPoints
      }
    }
  }
`;

export const GET_HOME_TICKET_PRS = gql`
  query GetHomeTicketPrs($keys: [String!]!) {
    ticketPullRequests(keys: $keys) {
      key
      labels
      pullRequests { id url repo pullNumber status mergeable }
    }
  }
`;

export const GET_HOME_SECONDARY = gql`
  query GetHomeSecondary($calendar: Boolean = true, $docker: Boolean = true, $monitors: Boolean = true) {
    needsAttention {
      id
      type
      message
      ticketKey
      prUrl
      owner
      repo
      pullNumber
    }
    orchestrations {
      key
      machine
      kind
      title
      stage
      waiting
      acPassed
      acFailed
      acTotal
      activity
      idleSeconds
      endedSeconds
      stalled
      finished
    }
    calendarEvents(maxResults: 50) @include(if: $calendar) {
      id
      title
      start
      end
      allDay
      location
      url
      calendarId
    }
    monitors(refresh: true) @include(if: $monitors) {
      id
      name
      url
      lastStatus
      lastStatusCode
      lastLatencyMs
      lastCheckedAt
    }
    settings {
      serviceHealthRefreshSeconds
    }
    dockerRuntime @include(if: $docker) {
      available
      total
      running
      stopped
      containers { id name image state uptime }
    }
  }
`;

export const GET_CALENDAR = gql`
  query GetCalendar($timeMin: String, $timeMax: String, $maxResults: Int) {
    calendarEvents(timeMin: $timeMin, timeMax: $timeMax, maxResults: $maxResults) {
      id
      title
      start
      end
      allDay
      location
      url
      calendarId
    }
  }
`;

export const GET_SPRINT_LIST = gql`
  query GetSprintList {
    sprintList {
      id
      name
      state
      startDate
      endDate
      computedAt
      lastError
    }
  }
`;

export const GET_SPRINT_DASHBOARD = gql`
  query GetSprintDashboard($sprintId: Int) {
    sprintDashboard(sprintId: $sprintId) {
      summary {
        id
        name
        state
        startDate
        endDate
        computedAt
        lastError
      }
      result
      refreshState {
        status
        label
        done
        total
        error
      }
    }
  }
`;

export const GET_SPRINT_TREND = gql`
  query GetSprintTrend {
    sprintTrend
  }
`;

export const GET_SPRINT_SETTINGS = gql`
  query GetSprintSettings {
    sprintDashboardSettings {
      boardId
      config
    }
  }
`;

export const GET_MONITORS = gql`
  query GetMonitors($refresh: Boolean = false, $docker: Boolean = true) {
    monitors(refresh: $refresh) {
      id
      name
      url
      expectedStatus
      timeoutMs
      lastStatus
      lastStatusCode
      lastLatencyMs
      lastCheckedAt
      lastError
    }
    settings {
      serviceHealthRefreshSeconds
    }
    dockerRuntime @include(if: $docker) {
      available
      total
      running
      stopped
      containers { id name image state uptime }
    }
  }
`;

export const GET_DOCKER_RUNTIME = gql`
  query GetDockerRuntime($includeStats: Boolean = true) {
    dockerRuntime(includeStats: $includeStats) {
      available
      engineVersion
      serverName
      total
      running
      stopped
      images
      refreshedAt
      error
      containers {
        id
        name
        project
        image
        command
        state
        status
        ports
        createdAt
        uptime
        cpuPercent
        memoryUsageBytes
        memoryLimitBytes
        memoryPercent
      }
    }
  }
`;

export const GET_DOCKER_CONTAINER_LOGS = gql`
  query GetDockerContainerLogs($id: ID!, $tail: Int = 100) {
    dockerContainerLogs(id: $id, tail: $tail)
  }
`;

export const GET_JIRA_PROJECTS = gql`
  query GetJiraProjects($url: String, $email: String, $token: String) {
    jiraProjects(url: $url, email: $email, token: $token) {
      id
      key
      name
    }
  }
`;

export const GET_GITHUB_REPOS = gql`
  query GetGithubRepos($token: String) {
    githubRepos(token: $token) {
      id
      name
      fullName
      private
      url
      description
    }
  }
`;

export const ORCHESTRATION_FIELDS = `
  key
  kind
  title
  stage
  waiting
  gate
  ac { n state text evidence }
  acPassed
  acFailed
  acTotal
  testsBe
  testsFe
  prBe
  prFe
  pullRequests {
    url
    number
    repo
    status
    reviewDecision
    checks
  }
  review
  reviewSignal
  finished
  note
  brief
  decisions { n at text status by issue cancelNote effect alts { label effect } replaces supersededBy }
  confirmedDecisions
  assumptions { n text falsifier state evidence }
  failures { at type what evidence attempt }
  closing { hours fixRounds replans }
  findings { at severity text resolvedAt resolvedWhy }
  lgtm { at text }
  verdict
  readyForQa { ready reasons }
  engine
  rounds { used max }
  stackedOn { key be { pr branch base retargetedAt } fe { pr branch base retargetedAt } }
  productionData
  draft
  issues { n at type text level status resolvedBy resolvedAt options effects }
  blockers
  activity
  activityDetail
  idleSeconds
  endedSeconds
  stalled
  hasTranscript
  machine
  updatedAt
`;

export const GET_DOCTOR_REPORTS = gql`
  query GetDoctorReports {
    doctorReports {
      machine
      host
      os
      at
      receivedAt
      kitVersion
      checks { name ok detail }
    }
  }
`;

export const GET_ORCHESTRATIONS = gql`
  query GetOrchestrations {
    orchestrations {
      ${ORCHESTRATION_FIELDS}
      approved
      members { id parentId name detail state tool tools }
    }
  }
`;

export const GET_RUN_THINKING = gql`
  query GetRunThinking($key: String!) {
    runThinking(key: $key) { id at stageIndex round agent kind topic text answer options { label why chosen } flag }
  }
`;

export const GET_RUN_THINKING_RAW = gql`
  query GetRunThinkingRaw($key: String!, $at: String!, $until: String) {
    runThinkingRaw(key: $key, at: $at, until: $until) { at agent kind text }
  }
`;

export const GET_RETRO = gql`
  query GetRetro($sprintId: Int) {
    retro(sprintId: $sprintId) {
      sprint
      sprintId
      previous
      numbers { tickets medianHours fixRounds replans ownerIssues medianOwnerWaitHours reviews requestChanges blockedWaits mergeConflicts stackedRebases }
      previousNumbers { tickets medianHours fixRounds replans ownerIssues medianOwnerWaitHours reviews requestChanges blockedWaits mergeConflicts stackedRebases }
      problems { label count tickets }
      tickets { key title kind hours rounds issues ownerWaitHours result }
      escalations { tickets planned causes { cause label count tickets } unpredicted { key summary causes prediction } }
      items { id kind text evidence dest status sessionId updatedAt }
    }
  }
`;

export const GET_SPRINT_PLAN = gql`
  query GetSprintPlan {
    sprintPlan {
      sprint
      status
      error
      sessionId
      mappedAt
      groups
      tickets {
        key title status position held
        edges { id ticketKey dependsOnKey dependsOnTitle dependsOnAssignee dependsOnStatus source reason state }
      }
    }
  }
`;

export const SPRINT_PLAN_MAP = gql`
  mutation SprintPlanMap {
    sprintPlanMap
  }
`;

export const SPRINT_PLAN_EDGE_ACTION = gql`
  mutation SprintPlanEdgeAction($id: ID!, $action: String!) {
    sprintPlanEdgeAction(id: $id, action: $action) { id ticketKey dependsOnKey dependsOnTitle dependsOnAssignee dependsOnStatus source reason state }
  }
`;

export const RETRO_BUILD = gql`
  mutation RetroBuild($sprintId: Int!) {
    retroBuild(sprintId: $sprintId)
  }
`;

export const RETRO_ITEM_ACTION = gql`
  mutation RetroItemAction($id: ID!, $action: String!, $text: String) {
    retroItemAction(id: $id, action: $action, text: $text) { id kind text evidence dest status sessionId updatedAt }
  }
`;

export const SPRINT_DRAFT_FIELDS = `
  sprint sprintId status sprintDays startDate spPerDay createdBy loadedAt publishedAt qaReason devs blockers canPublish landed today
  tickets {
    key summary dev jiraDev sp left wave waveSet status ac dependsOn start dur end inSprint split
    prediction { prediction reasons fix }
    qaDecision { action note by at }
    epic frames
    storyboard { version frames held checked { action note by at } }
    tcs { id ac title steps expected } tcStale tcPending tcApproved acHash
    merge pulls jiraAhead merged rank planStart planDur
  }
  findings { id key line text refKey kind refEnd ownEnd linked decision { action note by at } }
  storyboards {
    epic version previous path page frames changed changedAt checkedAt error htmlUrl previousHtmlUrl
    scenarios { n title groups { title flows { id title tickets info changed frames { index title step changed } } } }
  }
  questions { id text key askedAt answered answeredBy answeredAt answer options }
  developers { name merged open sp leftSp end }
  mergeSource
  moves { keys from to sp forecastBefore forecastAfter improves }
  scopeCut { action note by at }
`;

export const TICKET_SUMMARY_FIELDS = `key acHash made checked notHere waitsOn before after line testData ui acId titleId writtenAt current`;

export const GET_TICKET_SUMMARY = gql`
  query GetTicketSummary($key: String!) {
    ticketSummary(key: $key) { ${TICKET_SUMMARY_FIELDS} acChangedAt }
  }
`;

export const GET_TICKET_READINESS = gql`
  query GetTicketReadiness($keys: [String!]!, $refs: [String!]) {
    ticketReadiness(keys: $keys, refs: $refs) {
      tickets { key sprint tcApproved decisions { refKey action } summary { ${TICKET_SUMMARY_FIELDS} } }
      statuses { key status }
    }
  }
`;

export const GET_PLANNING_SPRINTS = gql`
  query GetPlanningSprints {
    planningSprints { id name state startDate endDate }
  }
`;

export const GET_SPRINT_DRAFT = gql`
  query GetSprintDraft($sprint: String!) {
    sprintDraft(sprint: $sprint) { ${SPRINT_DRAFT_FIELDS} }
  }
`;

export const GET_SPRINT_PLAN_SIGNAL = gql`
  query GetSprintPlanSignal($sprint: String!) {
    sprintPlanSignal(sprint: $sprint) {
      sprint sprintId sprintState activeSince stage revision publishedBy publishedAt planner me isPlanner draftLoadedAt draftStatus
      joined acChanged waitForPublish planAfterPublish myOutside
      myOrder { key summary status sp order }
    }
  }
`;

export const GET_PLANNING_FLOW = gql`
  query GetPlanningFlow {
    planningFlow
  }
`;

export const SET_PLANNING_FLOW = gql`
  mutation SetPlanningFlow($flow: String!) {
    setPlanningFlow(flow: $flow)
  }
`;

export const PREVIEW_SPRINT_DRAFT_PUBLISH = gql`
  query PreviewSprintDraftPublish($sprint: String!) {
    previewSprintDraftPublish(sprint: $sprint) { key assigneeFrom assigneeTo acRemoved acAdded referenceAdded blockedBy refused }
  }
`;

export const LOAD_SPRINT_DRAFT = gql`
  mutation LoadSprintDraft($sprintId: Int!) {
    loadSprintDraft(sprintId: $sprintId) { ${SPRINT_DRAFT_FIELDS} }
  }
`;

export const UPDATE_SPRINT_DRAFT_TICKET = gql`
  mutation UpdateSprintDraftTicket($sprint: String!, $key: String!, $dev: String, $wave: Int, $sp: Float, $ac: [String!]) {
    updateSprintDraftTicket(sprint: $sprint, key: $key, dev: $dev, wave: $wave, sp: $sp, ac: $ac) { ${SPRINT_DRAFT_FIELDS} }
  }
`;

export const MOVE_SPRINT_DRAFT_CARDS = gql`
  mutation MoveSprintDraftCards($sprint: String!, $keys: [String!]!, $to: String!) {
    moveSprintDraftCards(sprint: $sprint, keys: $keys, to: $to) { ${SPRINT_DRAFT_FIELDS} }
  }
`;

export const DECIDE_SPRINT_DRAFT = gql`
  mutation DecideSprintDraft($sprint: String!, $id: ID!, $action: String!, $note: String) {
    decideSprintDraft(sprint: $sprint, id: $id, action: $action, note: $note) { ${SPRINT_DRAFT_FIELDS} }
  }
`;

export const REFRESH_SPRINT_DRAFT_QA = gql`
  mutation RefreshSprintDraftQa($sprint: String!) {
    refreshSprintDraftQa(sprint: $sprint) { ${SPRINT_DRAFT_FIELDS} }
  }
`;

export const SPRINT_DRIFT_FIELDS = `
  sprint publishedAt today
  rows { id key line text refKey refStatus refDev refEnd ownEnd reason state decision { action state note by at } }
  storyboard { key version frames held checked }
`;

export const OPEN_PLANNING_CHAT = gql`
  mutation OpenPlanningChat($sprint: String!) {
    openPlanningChat(sprint: $sprint)
  }
`;

export const GET_AC_INCOMING = gql`
  query GetAcIncoming {
    acIncoming { id from to line text by at }
  }
`;

export const AC_IN_ACTION = gql`
  mutation AcInAction($to: String!, $id: ID!, $action: String!, $reason: String) {
    acInAction(to: $to, id: $id, action: $action, reason: $reason) { id from to line text by at }
  }
`;

export const GET_SPRINT_DRIFT = gql`
  query GetSprintDrift {
    sprintDrift { ${SPRINT_DRIFT_FIELDS} }
  }
`;

export const SPRINT_DRIFT_ACTION = gql`
  mutation SprintDriftAction($id: ID!, $action: String!, $note: String) {
    sprintDriftAction(id: $id, action: $action, note: $note) { ${SPRINT_DRIFT_FIELDS} }
  }
`;

export const SET_SPRINT_DRAFT_TCS = gql`
  mutation SetSprintDraftTcs($sprint: String!, $key: String!, $tcs: [SprintDraftTcInput!]!) {
    setSprintDraftTcs(sprint: $sprint, key: $key, tcs: $tcs) { ${SPRINT_DRAFT_FIELDS} }
  }
`;

export const ANSWER_SPRINT_DRAFT_QUESTION = gql`
  mutation AnswerSprintDraftQuestion($sprint: String!, $id: ID!, $answered: Boolean!, $text: String) {
    answerSprintDraftQuestion(sprint: $sprint, id: $id, answered: $answered, text: $text) { ${SPRINT_DRAFT_FIELDS} }
  }
`;

export const CHECK_SPRINT_STORYBOARDS = gql`
  mutation CheckSprintStoryboards($sprint: String!) {
    checkSprintStoryboards(sprint: $sprint) { ${SPRINT_DRAFT_FIELDS} }
  }
`;

export const UPLOAD_SPRINT_STORYBOARD = gql`
  mutation UploadSprintStoryboard($sprint: String!, $epic: String!, $html: String!) {
    uploadSprintStoryboard(sprint: $sprint, epic: $epic, html: $html) { ${SPRINT_DRAFT_FIELDS} }
  }
`;

export const PUBLISH_SPRINT_DRAFT = gql`
  mutation PublishSprintDraft($sprint: String!) {
    publishSprintDraft(sprint: $sprint) { key kind status detail }
  }
`;

export const GET_ORCHESTRATION = gql`
  query GetOrchestration($key: String!) {
    orchestration(key: $key) {
      ${ORCHESTRATION_FIELDS}
      approved
      events { id kind detail at }
      timeline {
        stageIndex
        hasGate
        gates { id stageIndex text state at }
        agents { id parentId name detail state tool tools }
        visits { stageIndex round from to agents { id parentId name detail state tool tools since until } }
        buckets { n gate }
        totalTools
        log { at kind head text }
      }
    }
  }
`;

export const GET_INGEST_TOKENS = gql`
  query GetIngestTokens {
    ingestTokens {
      id
      name
      prefix
      machine
      createdAt
      lastUsedAt
    }
  }
`;

export const CHAT_SESSION_FIELDS = `
  id
  source
  title
  ticketKey
  forkFrom
  machine
  status
  statusDetail
  messageCount
  startedAt
  lastMessageAt
  lastText
  waiting
  workerCount
  reviewRound { status summary threadUrl at }
`;

export const CHAT_INTERACTION_FIELDS = `
  id
  sessionId
  turnId
  kind
  title
  body
  state
  createdAt
  expiresAt
  answeredAt
`;

export const CHAT_MESSAGE_FIELDS = `
  id
  sessionId
  role
  text
  state
  at
  stopped
  attachments {
    id
    name
    mime
    size
    state
  }
`;

export const GET_CHAT_SESSIONS = gql`
  query GetChatSessions($source: String, $limit: Int) {
    chatSessions(source: $source, limit: $limit) {
      ${CHAT_SESSION_FIELDS}
    }
  }
`;

export const GET_CHAT_SESSION_STATES = gql`
  query GetChatSessionStates($limit: Int) {
    chatSessionStates(limit: $limit) {
      id
      title
      status
      statusDetail
      origin
      ticketKey
    }
  }
`;

export const GET_CHAT_SESSION_WORKERS = gql`
  query GetChatSessionWorkers($sessionId: ID!) {
    chatSessionWorkers(sessionId: $sessionId) {
      id
      parentId
      turnId
      name
      label
      status
      startedAt
      endedAt
    }
  }
`;

export const GET_CHAT_SESSION = gql`
  query GetChatSession($id: ID!) {
    chatSession(id: $id) {
      ${CHAT_SESSION_FIELDS}
      pending {
        ${CHAT_INTERACTION_FIELDS}
      }
      settled {
        id
        state
        decision
      }
      options {
        model
        effort
        permissionMode
        fast
      }
    }
    chatBridge {
      online
      lastSeenAt
    }
    chatMachines {
      name
      online
      lastSeenAt
      capabilities
    }
  }
`;

export const GET_CHAT_MESSAGES = gql`
  query GetChatMessages($sessionId: ID!, $afterId: Int, $beforeId: Int, $limit: Int) {
    chatMessages(sessionId: $sessionId, afterId: $afterId, beforeId: $beforeId, limit: $limit) {
      ${CHAT_MESSAGE_FIELDS}
    }
  }
`;

export const CHAT_ACTIVITY_FIELDS = `
  id
  sessionId
  turnId
  eventId
  parentId
  kind
  agent
  name
  label
  summary
  status
  hasDetail
  seq
  startedAt
  endedAt
`;

export const GET_CHAT_ACTIVITY = gql`
  query GetChatActivity($sessionId: ID!, $afterSeq: Int, $fromTurnId: Int, $beforeTurnId: Int, $limit: Int) {
    chatActivity(sessionId: $sessionId, afterSeq: $afterSeq, fromTurnId: $fromTurnId, beforeTurnId: $beforeTurnId, limit: $limit) {
      ${CHAT_ACTIVITY_FIELDS}
    }
  }
`;

export const GET_CHAT_ACTIVITY_DETAIL = gql`
  query GetChatActivityDetail($sessionId: ID!, $id: Int!) {
    chatActivityDetail(sessionId: $sessionId, id: $id)
  }
`;

export const SEARCH_CHAT = gql`
  query SearchChat($query: String!, $limit: Int) {
    chatSearch(query: $query, limit: $limit) {
      session {
        ${CHAT_SESSION_FIELDS}
      }
      messageId
      snippet
      at
    }
  }
`;

export const GET_CHAT_BRIDGE = gql`
  query GetChatBridge {
    chatBridge {
      online
      lastSeenAt
    }
  }
`;

export const GET_CHAT_MACHINES = gql`
  query GetChatMachines {
    chatMachines {
      name
      online
      lastSeenAt
    }
  }
`;

export const GET_CHAT_STATUS = gql`
  query GetChatStatus($machine: String) {
    chatStatus(machine: $machine) {
      limits {
        fiveHour { usedPercentage resetsAt }
        sevenDay { usedPercentage resetsAt }
        receivedAt
        stale
      }
      sessions {
        sessionId
        model
        effort
        fastMode
        contextPercentage
        contextTokens
        contextSize
        costUsd
        cacheWarm
        cacheHitRatio
        files { path added removed }
        receivedAt
        stale
      }
    }
  }
`;

export const GET_CHAT_BALLOONS = gql`
  query GetChatBalloons {
    chatBalloons {
      ${CHAT_MESSAGE_FIELDS}
    }
    chatSessions(source: "dock", limit: 300) {
      id
      ticketKey
    }
  }
`;

export const GET_ORCHESTRATOR_CRON_SETTINGS = gql`
  query GetOrchestratorCronSettings {
    orchestratorCronSettings {
      config
      lastFill
    }
  }
`;

export const GET_ORCHESTRATOR_CRON_STATUS = gql`
  query GetOrchestratorCronStatus {
    orchestratorCronStatus
  }
`;

export const GET_PUSH_PUBLIC_KEY = gql`
  query GetPushPublicKey {
    pushPublicKey
  }
`;

export const GET_DEMO_VIDEOS = gql`
  query GetDemoVideos {
    demoVideos {
      videos { ticketKey url size updatedAt title }
    }
  }
`;

export const GET_DEV_SERVERS = gql`
  query GetDevServers {
    devServers {
      main { name folder port running pid state error ticketKey hasLog }
      secondary { name folder port running pid state error ticketKey hasLog }
      actions { at target action ok output }
    }
  }
`;

export const GET_DEV_SERVER_LOG = gql`
  query GetDevServerLog($name: String!, $bytes: Int) {
    devServerLog(name: $name, bytes: $bytes)
  }
`;

export const GET_ELEVENLABS_KEYS = gql`
  query GetElevenLabsKeys {
    elevenLabsKeys {
      name
      masked
      parkedUntil
      current
    }
  }
`;

export const GET_ELEVENLABS_QUOTA = gql`
  query GetElevenLabsQuota {
    elevenLabsQuota {
      name
      characterCount
      characterLimit
      resetsAt
      hidden
      error
    }
  }
`;

export const GET_DEMO_STORAGE = gql`
  query GetDemoStorage {
    demoStorage { configured endpoint region bucket folder publicBaseUrl accessKeyMasked secretSet }
  }
`;

export const GET_AGENT_LOOKS = gql`
  query GetAgentLooks {
    agentLooks { slug displayName initials color avatarUrl }
  }
`;

export const GET_LIBRARY_AGENTS = gql`
  query GetLibraryAgents($machine: String) {
    libraryAgents(machine: $machine) {
      slug source description model tools guardProfile hasHooks dispatchable
      locked { slug tools hooks }
    }
  }
`;

export const GET_LIBRARY_AGENT = gql`
  query GetLibraryAgent($slug: String!, $machine: String) {
    libraryAgent(slug: $slug, machine: $machine) {
      slug source description model tools guardProfile hasHooks dispatchable
      locked { slug tools hooks }
      body hooksText kitBody
    }
  }
`;

export const DISCORD_THREAD_FIELDS = gql`
  fragment DiscordThreadFields on DiscordThreads {
    configured
    ownerSet
    live
    syncedAt
    error
    channels { id name kind thread enabled team }
    rows {
      id
      channelId
      channel
      kind
      title
      url
      state
      why
      needsYou
      older
      dismissed
      createdBy
      createdByAvatar
      createdAt
      lastActivity
      messageCount
      tags
      slots
      reviewing
      tickets { key status assignee sprint sprintActive }
      prs
      claim { author mine at }
      onIt
      passes
      autoReviewSkip
      claimerRepliedAt
      mentionedAt
      repliedAt
      messages {
        id
        author
        avatar
        mine
        at
        text
        mentions { id name me role }
        attachments { name size type url width height }
      }
    }
  }
`;

export const GET_DISCORD_THREADS = gql`
  query GetDiscordThreads {
    discordThreads { ...DiscordThreadFields }
  }
  ${DISCORD_THREAD_FIELDS}
`;

export const GET_DOCK_BUILD = gql`
  query GetDockBuild {
    dockBuild
  }
`;

export const GET_DOCK_ISSUES = gql`
  query GetDockIssues($filter: DockIssueFilter!) {
    dockIssues(filter: $filter) {
      tokenMissing
      viewer
      issues { number title state author { login avatarUrl } createdAt updatedAt comments url }
    }
  }
`;

export const GET_DOCK_ISSUE = gql`
  query GetDockIssue($number: Int!) {
    dockIssue(number: $number) {
      number title state author { login avatarUrl } createdAt updatedAt comments url body
      commentList { id author { login avatarUrl } createdAt body }
    }
  }
`;

export const GET_DOCK_ISSUE_DRAFT_URL = gql`
  query GetDockIssueDraftUrl($title: String!, $happened: String!, $steps: String, $expected: String, $imageLinks: [String!], $page: String!) {
    dockIssueDraftUrl(title: $title, happened: $happened, steps: $steps, expected: $expected, imageLinks: $imageLinks, page: $page)
  }
`;

export const GET_CLAUDE_USAGE = gql`
  query GetClaudeUsage($from: String!, $to: String!) {
    claudeUsage(from: $from, to: $to) {
      available
      error
      totals { inputTokens outputTokens cacheCreationTokens cacheReadTokens totalTokens cost }
      days { date totalTokens cost }
      models { model inputTokens outputTokens cacheCreationTokens cacheReadTokens totalTokens cost }
    }
  }
`;

export const GET_AUTO_REVIEWS = gql`
  query GetAutoReviews {
    autoReviews { id ticketKey prUrl headSha threadUrl sessionId status detail startedAt finishedAt }
  }
`;

export const CLAUDE_ACCOUNTS_FIELDS = `
  available
  accounts { name active seenAt status checkedAt source fiveHour { usedPercentage resetsAt } sevenDay { usedPercentage resetsAt } }
  rotation { enabled fiveHour sevenDay backToMain }
  log { at from to reason auto }
`;

export const QA_LOCAL_FIELDS = `
  available
  autoRun
  trigger { at sessionId pullRequests error }
  run {
    runId state step verdict rule passed failed blocked error startedAt updatedAt finishedAt
    steps { id label state }
    testCases { id title ac state seconds video note }
  }
`;

export const GET_QA_LOCAL = gql`
  query GetQaLocal($ticketKey: String) {
    qaLocal(ticketKey: $ticketKey) { ${QA_LOCAL_FIELDS} }
  }
`;

export const GET_DEPLOY_GATE = gql`
  query GetDeployGate($ticketKey: String!) {
    deployGate(ticketKey: $ticketKey) { key ready summary repos { repo pull state mergeSha runUrl finishedAt detail } }
  }
`;

export const GET_CLAUDE_ACCOUNTS = gql`
  query GetClaudeAccounts {
    claudeAccounts { ${CLAUDE_ACCOUNTS_FIELDS} }
  }
`;

export const PULL_CHANGE_FILE_FIELDS = gql`
  fragment PullChangeFileFields on PullChangeFile {
    path
    previousPath
    status
    additions
    deletions
    patch
    tooLarge
  }
`;

export const GET_TICKET_CHANGES = gql`
  ${PULL_CHANGE_FILE_FIELDS}
  query GetTicketChanges($ticketKey: String!, $tab: String) {
    ticketChanges(ticketKey: $ticketKey, tab: $tab) {
      ticketKey
      title
      error
      pulls {
        url
        owner
        repo
        number
        tab
        title
        state
        author
        headRef
        baseRef
        headSha
        headDate
        additions
        deletions
        changedFiles
        partial
        stale
        retryAt
        error
        files { ...PullChangeFileFields }
      }
      review {
        runKey
        verdict
        roundsUsed
        roundsMax
        updatedAt
        findings { at severity text resolvedAt resolvedWhy }
      }
    }
  }
`;

export const GET_PULL_FILE_PATCH = gql`
  ${PULL_CHANGE_FILE_FIELDS}
  query GetPullFilePatch($ticketKey: String!, $url: String!, $path: String!) {
    pullFilePatch(ticketKey: $ticketKey, url: $url, path: $path) { ...PullChangeFileFields }
  }
`;

export const GET_PULL_FILE_LINES = gql`
  query GetPullFileLines($ticketKey: String!, $url: String!, $path: String!, $ref: String!, $from: Int!, $to: Int!) {
    pullFileLines(ticketKey: $ticketKey, url: $url, path: $path, ref: $ref, from: $from, to: $to)
  }
`;

export const GET_WORKSPACE_DIR = gql`
  query GetWorkspaceDir($path: String) {
    workspaceDir(path: $path) {
      path
      parent
      truncated
      entries { name path kind size modifiedAt masked }
    }
  }
`;

export const GET_WORKSPACE_FILE = gql`
  query GetWorkspaceFile($path: String!) {
    workspaceFile(path: $path) { path size modifiedAt masked binary truncated text }
  }
`;

export const WORKSPACE_MKDIR = gql`
  mutation WorkspaceMkdir($path: String!) {
    workspaceMkdir(path: $path) { name path kind size modifiedAt masked }
  }
`;

export const WORKSPACE_RENAME = gql`
  mutation WorkspaceRename($from: String!, $to: String!) {
    workspaceRename(from: $from, to: $to) { name path kind size modifiedAt masked }
  }
`;

export const WORKSPACE_DELETE = gql`
  mutation WorkspaceDelete($path: String!) {
    workspaceDelete(path: $path)
  }
`;
