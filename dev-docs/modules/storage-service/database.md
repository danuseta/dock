# Storage Service Database

## Schema
- `files`: Table storing `id`, `filename`, `mime_type`, `size`, `provider`, `path`, `created_at`.

## Caching
- Presigned URLs are temporarily cached if requested multiple times within the TTL.