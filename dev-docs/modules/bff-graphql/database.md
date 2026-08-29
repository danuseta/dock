# BFF GraphQL Database

## Ownership
The BFF module does not own any persistent database tables directly. It acts as an aggregator.

## Caching
- **Redis**: Used for query caching, session storage, and rate-limiting counters.
- **Apollo Cache Control**: Defines cache max-age and scopes for GraphQL responses.