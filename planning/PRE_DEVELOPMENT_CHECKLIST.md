# Pre-Development Checklist

Before writing any code, ensure the following steps and validations are completed.

## 1. System Requirements & Environment
- [ ] Node.js v18+ installed locally.
- [ ] Docker & Docker Compose installed (for PostgreSQL/Storage Service).
- [ ] `npm` or `yarn` or `pnpm` configured.
- [ ] IDE (VSCode / WebStorm) configured with Prettier and ESLint.

## 2. Access Credentials & Tokens
- [ ] Jira: Valid Atlassian API Token generated and tested.
- [ ] GitHub: Valid Personal Access Token (classic or fine-grained) generated with `repo` read access.
- [ ] Discord: Webhook URL created in a test server/channel.

## 3. Project Initialization
- [ ] Initialize Git repository.
- [ ] Set up monorepo structure (e.g., using Nx or Turborepo, or simple subfolders for `frontend`, `bff`, `services`).
- [ ] Initialize `docker-compose.yml` for PostgreSQL database.

## 4. Documentation Validation
- [ ] `PROJECT_BRIEF.md` read and acknowledged.
- [ ] `prd.md` reviewed for scope boundaries.
- [ ] `architecture.md` and `modules.md` approved by stakeholders.
- [ ] `api-contract.md` schemas match the expected data flow.
- [ ] `wireframe.md` design tokens added to frontend CSS variables.
- [ ] `database.md` schema applied to local init SQL script.

## 5. Risk Assessment (From `14-Asumsi-Risiko-Teknis.md`)
- [ ] **Rate Limiting:** Ensure BFF caching logic is planned before making raw external API calls.
- [ ] **Data Privacy:** Ensure `.env` files are in `.gitignore` and credentials are never logged to console.
- [ ] **Naming Conventions:** Confirm that existing PRs in GitHub actually use the `JID-XXX` format in titles or branches to ensure the core feature works.

## 6. Ready to Code
- [ ] Checkout `feature/init-project` branch.
- [ ] Begin Phase 2 (Foundation & Storage Service).
