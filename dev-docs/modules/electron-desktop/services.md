# Electron Desktop Services

## Main Process Services
- `WindowManager`: Creates and manages `BrowserWindow` instances.
- `TrayManager`: Manages the system tray icon and context menu.
- `StoreService`: Uses `electron-store` for persisting user preferences locally.

## Renderer Process Services
- `ApolloClient`: Configured to talk to the BFF.
- `StateManagement`: Zustand or Redux for frontend state.