import { gql } from '@apollo/client';

export const GET_AUTH_STATUS = gql`
  query GetAuthStatus {
    authStatus {
      authenticated
      hasMasterPin
    }
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
        sprintName
        sprintState
        storyPoints
        labels
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
    }
  }
`;

export const GET_TICKET_DETAIL_CORE = gql`
  query GetTicketDetailCore($key: String!) {
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
    }
    ticketRelationGroup(ticketKey: $key) {
      primaryKey
      dependsOnKey
      ticketKeys
    }
    dashboard {
      tickets { key title status }
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
      discordMessageTemplate
      hasGoogleClientSecret
      googleCalendarConnected
      serviceHealthRefreshSeconds
      hasMasterPin
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

export const GET_HOME_SECONDARY = gql`
  query GetHomeSecondary {
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

export const GET_MONITORS = gql`
  query GetMonitors($refresh: Boolean = false) {
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
    dockerRuntime {
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
