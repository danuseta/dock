#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..', '..', 'frontend');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const port = Number(arg('--port', 3710));
const backend = arg('--backend', 'http://localhost:4710');

const viteRoot = path.dirname(createRequire(path.join(frontend, 'package.json')).resolve('vite/package.json'));
const { createServer } = await import(pathToFileURL(path.join(viteRoot, 'dist', 'node', 'index.js')).href);
const server = await createServer({
  root: frontend,
  configFile: path.join(frontend, 'vite.config.ts'),
  server: { port, strictPort: true, proxy: { '/api': { target: backend, changeOrigin: false } } },
});
await server.listen();
server.printUrls();
