# ADR 004: Electron Desktop Application

## Status
Accepted

## Context
JIDIS is intended as a personal developer tool running locally on Windows. It requires access to local secure storage for credentials and should be accessible outside of the browser (e.g., via a system tray icon).

## Decision
We will build the UI as an Electron desktop application using React/Next.js for the rendering layer.

## Consequences
- **Positive:** Deep OS integration (system tray, local notifications, secure credential vault).
- **Positive:** Familiar web development stack.
- **Negative:** Large binary size and higher memory footprint compared to a native C#/C++ application. Mitigated by modern hardware capabilities of developer machines.
