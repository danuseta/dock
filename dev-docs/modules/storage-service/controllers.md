# Storage Service Controllers

## FileController
- `upload`: Handles multipart/form-data, streams to storage provider.
- `download`: Pipes file stream to HTTP response.
- `generatePresigned`: Returns temporary URLs.