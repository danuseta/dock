# ADR 007: Local Credential Storage

## Status
Accepted

## Context
JIDIS requires highly sensitive credentials: Jira API Tokens, GitHub PATs, and Discord Webhook URLs. Because this is a locally run desktop application without a central server, we cannot store these in a centralized secrets manager (like AWS Secrets Manager).

## Decision
We will utilize the OS-native credential manager (Windows Credential Manager / macOS Keychain / Linux Secret Service) accessed via Electron's `safeStorage` API.

## Consequences
- **Positive:** High security; credentials are encrypted at rest using OS-level protection.
- **Positive:** The credentials never enter the React UI `localStorage` or `IndexedDB`, preventing XSS extraction.
- **Negative:** If the user moves to a new machine, they must manually re-enter their credentials.
