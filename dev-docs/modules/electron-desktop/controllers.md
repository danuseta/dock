# Electron Desktop Controllers

## IPC Controllers (Main Process)
- `SystemController`: Handles window management, tray, and OS-level tasks.
- `AuthController`: Manages secure storage of auth tokens (using Keytar or similar).
- `NetworkController`: Wraps fetch calls to the BFF GraphQL API.