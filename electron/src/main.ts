import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null;
let microservices: ChildProcess[] = [];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1E1E1E'
  });

  // For development, load local Vite server. In production, load built index.html
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../frontend/dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startMicroservices() {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (!isDev) return;

  // Example of spawning a microservice
  console.log('Starting microservices...');
  // const api = spawn('node', ['path/to/api.js']);
  // microservices.push(api);
}

function killMicroservices() {
  microservices.forEach(service => {
    if (service && !service.killed) {
      service.kill();
    }
  });
}

app.on('ready', () => {
  startMicroservices();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  killMicroservices();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
