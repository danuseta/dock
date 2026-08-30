import { gql } from '@apollo/client';

export const SAVE_DEMO_LINK = gql`
  mutation SaveDemoLink($ticketKey: String!, $url: String!) {
    saveDemoLink(ticketKey: $ticketKey, url: $url)
  }
`;

export const SEND_TO_DISCORD = gql`
  mutation SendToDiscord($ticketKey: String!, $customMessage: String, $threadId: String, $threadName: String) {
    sendToDiscord(ticketKey: $ticketKey, customMessage: $customMessage, threadId: $threadId, threadName: $threadName)
  }
`;

export const SET_TICKET_DEPENDENCY = gql`
  mutation SetTicketDependency($ticketKey: String!, $dependsOnKey: String!) {
    setTicketDependency(ticketKey: $ticketKey, dependsOnKey: $dependsOnKey) {
      primaryKey
      dependsOnKey
      ticketKeys
    }
  }
`;

export const CLEAR_TICKET_DEPENDENCY = gql`
  mutation ClearTicketDependency($ticketKey: String!) {
    clearTicketDependency(ticketKey: $ticketKey) {
      primaryKey
      dependsOnKey
      ticketKeys
    }
  }
`;

export const UPDATE_SETTINGS = gql`
  mutation UpdateSettings($input: SettingsInput!) {
    updateSettings(input: $input)
  }
`;

export const REFRESH_DATA = gql`
  mutation RefreshData {
    refreshData
  }
`;

export const CHECK_CONFLICTS = gql`
  mutation CheckConflicts($owner: String!, $repo: String!, $pullNumber: Int!) {
    checkConflicts(owner: $owner, repo: $repo, pullNumber: $pullNumber) {
      hasConflict
      message
    }
  }
`;

export const VALIDATE_JIRA = gql`
  mutation ValidateJira($url: String, $email: String, $token: String) {
    validateJira(url: $url, email: $email, token: $token) {
      success
      message
    }
  }
`;

export const VALIDATE_GITHUB = gql`
  mutation ValidateGitHub($token: String) {
    validateGitHub(token: $token) {
      success
      message
    }
  }
`;

export const VALIDATE_DISCORD = gql`
  mutation ValidateDiscord($webhookUrl: String) {
    validateDiscord(webhookUrl: $webhookUrl) {
      success
      message
    }
  }
`;

export const SET_MASTER_PIN = gql`
  mutation SetMasterPin($pin: String!) {
    setMasterPin(pin: $pin)
  }
`;

export const CHANGE_MASTER_PIN = gql`
  mutation ChangeMasterPin($oldPin: String!, $newPin: String!) {
    changeMasterPin(oldPin: $oldPin, newPin: $newPin)
  }
`;

export const VERIFY_MASTER_PIN = gql`
  mutation VerifyMasterPin($pin: String!) {
    verifyMasterPin(pin: $pin)
  }
`;

export const REMOVE_MASTER_PIN = gql`
  mutation RemoveMasterPin($oldPin: String!) {
    removeMasterPin(oldPin: $oldPin)
  }
`;

export const ADD_QUICK_LINK = gql`
  mutation AddQuickLink($input: QuickLinkInput!) {
    addQuickLink(input: $input) {
      id
      title
      url
      color
      position
    }
  }
`;

export const REMOVE_QUICK_LINK = gql`
  mutation RemoveQuickLink($id: ID!) {
    removeQuickLink(id: $id)
  }
`;

export const ADD_MONITOR = gql`
  mutation AddMonitor($input: MonitorTargetInput!) {
    addMonitor(input: $input) {
      id
      name
      url
      expectedStatus
      timeoutMs
    }
  }
`;

export const REMOVE_MONITOR = gql`
  mutation RemoveMonitor($id: ID!) {
    removeMonitor(id: $id)
  }
`;

export const UPDATE_MONITOR = gql`
  mutation UpdateMonitor($id: ID!, $input: MonitorTargetInput!) {
    updateMonitor(id: $id, input: $input) {
      id
      name
      url
      expectedStatus
      timeoutMs
    }
  }
`;

export const CHECK_MONITORS = gql`
  mutation CheckMonitors {
    checkMonitors {
      id
      lastStatus
      lastStatusCode
      lastLatencyMs
      lastCheckedAt
      lastError
    }
  }
`;

export const DISCONNECT_GOOGLE_CALENDAR = gql`
  mutation DisconnectGoogleCalendar {
    disconnectGoogleCalendar
  }
`;
