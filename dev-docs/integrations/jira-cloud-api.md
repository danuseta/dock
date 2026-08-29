# Jira Cloud API Integration Guide

This document outlines how JIDIS interacts with the Jira Cloud REST API.

## Authentication
Since JIDIS is a personal developer tool running locally, it utilizes **Basic Authentication** with an API Token, or **OAuth 2.0 (3LO)** if configured for a tighter security scope.
- **API Token Storage:** The API token is stored locally using the OS's native secure credential vault (e.g., Windows Credential Manager) via Electron's secure IPC.

## Key Endpoints Used

### 1. Get User Details
- **Endpoint:** `GET /rest/api/3/myself`
- **Purpose:** Validate credentials and fetch the `accountId` of the current user.

### 2. Search Assigned Tickets
- **Endpoint:** `GET /rest/api/3/search`
- **Payload/Query:** 
  ```json
  {
    "jql": "assignee = currentUser() AND statusCategory IN ('To Do', 'In Progress')",
    "fields": ["summary", "status", "issuetype", "updated"],
    "maxResults": 50
  }
  ```
- **Purpose:** Fetch active tickets assigned to the developer.

## Rate Limits
- Jira Cloud rate limits depend on the specific instance's plan.
- JIDIS implements a caching layer. The UI queries the local Database cache first, while a background job fetches updates from Jira every N minutes (configurable) to respect rate limits.

## Constraints
- **Read-Only:** JIDIS treats Jira as a read-only data source. It does not transition ticket statuses or add comments. All updates to Jira are done manually by the user in the browser.
