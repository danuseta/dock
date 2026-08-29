# ADR 006: Discord Webhook for Outbound Messaging

## Status
Accepted

## Context
The goal of JIDIS is to automate posting status updates to Discord. We could implement a full Discord Bot, but that requires setting up a bot application in the Discord Developer Portal, managing bot tokens, and dealing with WebSockets.

## Decision
We will use Discord Webhooks instead of a full Discord Bot.

## Consequences
- **Positive:** Extremely simple to set up. The user just pastes a URL.
- **Positive:** No WebSocket connections to maintain; entirely stateless HTTP POSTs.
- **Negative:** Webhooks cannot read messages from the channel or react to user interactions; they are strictly one-way (outbound). This is acceptable as JIDIS only needs to broadcast.
