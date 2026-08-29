# Docker Compose Setup

This document outlines the Docker Compose architecture for the JIDIS local development and production environments.

## Architecture Overview
The setup relies on multiple isolated services to ensure high availability and clean separation of concerns.

### Services:
- **db (PostgreSQL):** Relational database storing core data.
- **redis (Redis):** In-memory cache for sessions and rate limiting.
- **auth-service:** Microservice handling authentication and token issuance.
- **data-service:** Microservice managing core application business logic.
- **bff (Backend For Frontend):** GraphQL gateway aggregating microservices for the frontend.

## Network Isolation
- **Backend Network (`backend_net`):** An internal network without external access. The `db`, `redis`, `auth-service`, and `data-service` communicate exclusively on this network.
- **Frontend Network (`frontend_net`):** The `bff` is attached to both `backend_net` and `frontend_net`. It exposes port `4000` to the host machine for the frontend clients to consume.

## Startup Sequence & Dependencies
We use the `depends_on` condition to ensure proper startup sequencing:
1. `db` and `redis` start first. They include `healthcheck` configurations.
2. `auth-service` and `data-service` wait for `db` and `redis` to be `service_healthy`.
3. `bff` waits for `auth-service` and `data-service` to be `service_healthy`.

## Usage Commands

### Starting the Environment
```bash
# Start all services in detached mode
docker-compose up -d

# Start and force rebuild of images
docker-compose up -d --build
```

### Stopping the Environment
```bash
# Stop all services but preserve volumes (data intact)
docker-compose down

# Stop and remove all volumes (WIPES DB DATA)
docker-compose down -v
```

### Viewing Logs
```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f bff
```
