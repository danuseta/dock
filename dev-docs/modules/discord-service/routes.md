# Discord Service Routes

## Endpoints
- `POST /api/v1/notifications/send`: Internal endpoint to trigger a Discord message.

## Event Handlers (Discord WS)
- `interactionCreate`: Handles slash commands.
- `messageCreate`: Handles text-based bot interactions.