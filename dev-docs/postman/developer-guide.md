# JIDIS API Developer Guide

## Overview
This guide provides instructions on how to consume the JIDIS API using the provided Postman collection. JIDIS relies on a BFF (Backend For Frontend) architecture exposing a GraphQL API to the client applications (Web & Electron), and internal RESTful microservices for backend operations.

## Setup Instructions

### 1. Import Postman Collection and Environment
1. Open Postman.
2. Click **Import** and select `jidis-collection.json` and `jidis-environment.json` from the `dev-docs/postman/` directory.
3. In the top right corner of Postman, select **JIDIS Local Dev Environment** from the environment dropdown.

### 2. Authentication
All protected endpoints require a JWT token.
1. Run the **Login Mutation** under the **BFF GraphQL** folder.
2. Ensure the response contains a valid JWT.
3. Copy the token and paste it into the `auth_token` variable in your active Environment. The collection is configured to automatically use `{{auth_token}}` in the Authorization header.

### 3. Using the BFF GraphQL API
The frontend (Web and Electron apps) should exclusively communicate with the BFF GraphQL endpoint (`http://localhost:4000/graphql`).
- Explore the **BFF GraphQL** folder for queries and mutations.
- Use Postman's built-in GraphQL support to view the schema and autocomplete queries.

### 4. Using Internal Microservice APIs
Internal microservice REST APIs (`Auth Service`, `Data Service`) are not exposed directly to the public network. In local development, they run on ports `3001` and `3002`.
- These APIs are primarily used by the BFF or other backend services.
- You can test them directly using the respective folders in the Postman collection to ensure the services are running correctly.

## Best Practices
- **Never commit active JWT tokens** into the environment files.
- Always use the Postman environment variables instead of hardcoding URLs or tokens in the requests.
- When updating the GraphQL schema in the BFF, be sure to update the Postman queries accordingly.
