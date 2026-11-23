#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'bff-graphql');
const built = join(backend, 'dist', 'cli', 'setup.js');
const args = existsSync(built) ? [built] : ['--import', 'tsx', join(backend, 'src', 'cli', 'setup.ts')];
const result = spawnSync(process.execPath, [...args, ...process.argv.slice(2)], { cwd: backend, stdio: 'inherit' });
process.exit(result.status ?? 1);
