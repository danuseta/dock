# BFF GraphQL Views

## UI Components
None. This is a purely backend service.

## API Response Structures
Follows standard GraphQL JSON response format:
```json
{
  "data": {
    "getIssue": {
      "id": "1",
      "title": "Fix bug"
    }
  },
  "errors": []
}
```