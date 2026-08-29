# Electron Build Guide

This guide details the process for packaging the JIDIS frontend as a native Windows executable using `electron-builder`.

## Prerequisites
- Node.js (v18+)
- Python (v3) - Required for native node modules
- Visual Studio Build Tools (Desktop development with C++) - Required for native node modules on Windows

## Project Structure
The frontend code should be split into:
- `src/main`: Electron main process code (Node.js environment).
- `src/renderer`: React/Vite renderer process code (Browser environment).

## Configuration (`package.json`)
The `electron-builder` configuration is located within `package.json` under the `"build"` key.

```json
"build": {
  "appId": "com.jidis.app",
  "productName": "JIDIS",
  "directories": {
    "output": "dist-electron"
  },
  "win": {
    "target": [
      {
        "target": "nsis",
        "arch": [
          "x64"
        ]
      }
    ],
    "icon": "assets/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true
  }
}
```

## Build Process

### 1. Build the Renderer (Web)
First, the React/Vite frontend must be bundled into static files.
```bash
npm run build:web
```

### 2. Compile the Main Process
Compile the TypeScript Electron main process.
```bash
npm run build:main
```

### 3. Package the Executable
Package the compiled code and Node.js modules into the final installer `.exe`.
```bash
npm run build:electron
```
The final installer will be available in the `dist-electron/` directory.

## Troubleshooting
- **Native Module Compilation Errors:** Ensure `windows-build-tools` are properly installed. You may need to run `npm-gyp rebuild`.
- **White Screen on Launch:** This usually means the renderer path is incorrect in the main process when loading the `index.html` file in production mode. Verify the `win.loadFile()` path relative to the packaged app structure.
