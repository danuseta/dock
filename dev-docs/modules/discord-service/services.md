# Discord Service Business Logic

## DiscordBotManager
- Connects to Discord Gateway.
- Registers global and guild-specific slash commands.

## EmbedBuilderService
- Translates internal JIDIS events (e.g., `IssueCreated`) into beautifully formatted Discord Embeds with colors and fields.