# Discord Webhook Integration

JIDIS automates sending status updates to a Discord channel via Webhooks, eliminating manual copy-pasting.

## Setup
- The user provides a Discord Webhook URL in the JIDIS settings.
- URL format: `https://discord.com/api/webhooks/{webhook.id}/{webhook.token}`

## Outbound Message Formatting
The Discord Service formats the data into a rich Embed or Markdown block.

**Template Structure:**
```json
{
  "content": "Update for Ticket **JID-123**",
  "embeds": [
    {
      "title": "JID-123: Add new payment gateway",
      "url": "https://company.atlassian.net/browse/JID-123",
      "color": 3447003,
      "fields": [
        {
          "name": "Frontend PR",
          "value": "[#45 - Add UI components](https://github.com/repo/pull/45) (✅ Merged)",
          "inline": false
        },
        {
          "name": "Backend PR",
          "value": "[#89 - API Implementation](https://github.com/repo/pull/89) (👀 Needs Review)",
          "inline": false
        },
        {
          "name": "Demo",
          "value": "[Watch Recording](https://loom.com/share/...)",
          "inline": false
        }
      ]
    }
  ]
}
```

## Retry Handling & Error Management
- Discord enforces strict rate limits on Webhooks (typically 5 requests per 2 seconds).
- If a `429 Too Many Requests` is encountered, the service reads the `Retry-After` header.
- JIDIS implements an exponential backoff retry queue to ensure the message is delivered without crashing the service.
- If the Webhook URL is invalid (`401 Unauthorized` or `404 Not Found`), the failure is propagated back to the UI to prompt the user to check their settings.
