# Known Issues

## Active

- Root `.env` does not yet contain `ENCRYPTION_KEY` or
  `INTERNAL_SERVICE_TOKEN`; Compose correctly fails fast until the owner
  configures both values.
- Apollo Server v4 is end-of-life. Upgrade work and dependency audit findings
  are tracked in Beads as `jidis-y9h` and are intentionally outside Phase 2–3.
- Jira, GitHub, and Discord remain external HTTP services until Phases 4–5.

## Guidelines for Adding Issues
- Provide a clear description of the issue.
- Note the affected module.
- Add any relevant error logs or steps to reproduce.
- Link to a task in `TASKS.md` if applicable.
