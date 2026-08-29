# Electron Desktop IPC Routes

## IPC Channels (Main <-> Renderer)
- `ipcMain.handle('system:notify')`: Trigger OS notification.
- `ipcMain.handle('auth:login')`: Open OAuth window.
- `ipcMain.handle('config:get')`: Read local config file.
- `ipcMain.handle('graphql:query')`: Forward GraphQL request to BFF.