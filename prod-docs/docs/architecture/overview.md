# Architecture Overview

JIDIS uses a microservices-based architecture combined with a Backend For Frontend (BFF) pattern to serve multiple client applications (Web and Electron).

## System Components

### 1. Frontend Clients
- **Web Application:** Built with React/Vite, deployed as static assets to a CDN.
- **Electron Application:** Packaged desktop application for Windows, wrapping the web application with native capabilities.

### 2. API Gateway / BFF
- **BFF (Backend For Frontend):** A Node.js GraphQL server that acts as the single entry point for all frontend traffic. It aggregates data from internal microservices, handles rate limiting, and normalizes responses.

### 3. Microservices
- **Auth Service:** Manages user identities, JWT issuance, and validation.
- **Data Service:** Handles the core business logic and data manipulation.

### 4. Infrastructure/Data Layer
- **PostgreSQL:** The primary relational database, storing user data and application state.
- **Redis:** Used for session caching, rate limiting, and inter-service messaging/queues.

## Network Topology
- All microservices, databases, and caches reside in an isolated private network (e.g., AWS VPC private subnet).
- Only the BFF is exposed to the public internet via an Application Load Balancer / API Gateway.
