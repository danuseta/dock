# Discord Service Database

## Schema
- `discord_channels`: Maps Jira Project Keys to Discord Channel IDs.
- `discord_user_mappings`: Maps Discord User IDs to JIDIS/Atlassian User IDs.

## Caching
- Guild and Channel configurations are cached in memory/Redis.