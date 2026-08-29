# BFF GraphQL Module

## Overview
The BFF (Backend-For-Frontend) GraphQL module acts as the central API gateway for the JIDIS application. It aggregates data from various underlying microservices (Jira, GitHub, Discord, Storage) and provides a unified GraphQL interface for the Electron desktop client and any web interfaces.

## Responsibilities
- Schema federation and stitching.
- Authentication and authorization middleware.
- Rate limiting and request validation.
- Orchestrating complex mutations spanning multiple services.