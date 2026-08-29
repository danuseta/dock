# ADR 005: On-Demand Conflict Check

## Status
Accepted

## Context
Checking for merge conflicts requires querying the GitHub API for the PR's `mergeable` status and potentially diffing branches. Doing this continuously for every PR in the background would quickly exhaust the user's API rate limits and consume unnecessary CPU.

## Decision
We will fetch the basic PR list in the background, but the detailed conflict check (diff analysis) will only run *On-Demand* when the user interacts with a specific PR in the UI.

## Consequences
- **Positive:** Drastically reduces GitHub API usage.
- **Positive:** Keeps the application lightweight.
- **Negative:** The user experiences a slight delay (latency) when viewing PR details while the conflict calculation occurs.
