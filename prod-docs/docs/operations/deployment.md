# Production Deployment Guide

This document outlines the standard operating procedure for deploying JIDIS to the production environment.

## Prerequisites
- Access to the production Docker Swarm / Kubernetes cluster.
- Access to the CI/CD pipeline (e.g., GitHub Actions, GitLab CI).
- Production environment variables securely stored in the secret manager.

## Deployment Process

### 1. Pre-Deployment
1. Ensure all tests have passed on the `main` branch.
2. Review the Security Checklist in `docs/operations/security.md`.
3. Create a new Release tag in the repository.

### 2. CI/CD Automation
The CI/CD pipeline will automatically:
1. Build Docker images for the BFF, Auth Service, and Data Service.
2. Push images to the secure Container Registry.
3. Build the static Web assets and deploy to the CDN.
4. Trigger the Electron build for Windows and upload the installer to the release page.

### 3. Backend Deployment (Manual/Semi-Automated)
If deploying via Docker Compose / Swarm manually:
```bash
# Pull latest images
docker-compose -f docker-compose.prod.yml pull

# Apply database migrations
docker-compose -f docker-compose.prod.yml run --rm data-service npm run migrate:up

# Deploy the updated services
docker-compose -f docker-compose.prod.yml up -d
```

### 4. Post-Deployment Verification
1. Check the `/health` endpoint of the API Gateway.
2. Verify production logs for any immediate startup errors.
3. Perform a basic smoke test (Login, view dashboard).

## Rollback Procedure
If a critical failure occurs post-deployment:
1. Revert to the previous Docker image tags in the deployment configuration.
2. Run `docker-compose up -d` to pull and start the older images.
3. If database migrations were applied, run the down migrations CAREFULLY, or restore from the pre-deployment backup.
