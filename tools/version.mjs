import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASELINE = '2.0.0';

export function bumpVersion(base, subjects) {
  let [major, minor, patch] = base.split('.').map(Number);
  for (const subject of subjects) {
    if (/^Release:/i.test(subject) || /^Merge /.test(subject)) continue;
    if (/^feat(\([^)]*\))?!?:/.test(subject)) {
      minor += 1;
      patch = 0;
    } else if (/^fix(\([^)]*\))?!?:/.test(subject)) {
      patch += 1;
    }
  }
  return `${major}.${minor}.${patch}`;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

export function currentVersion() {
  let tag = '';
  try {
    tag = git(['describe', '--tags', '--abbrev=0', '--match', 'v*']);
  } catch {
    tag = '';
  }
  if (!tag) return BASELINE;
  const log = git(['log', `${tag}..HEAD`, '--first-parent', '--no-merges', '--reverse', '--format=%s']);
  return bumpVersion(tag.slice(1), log ? log.split('\n') : []);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${currentVersion()}\n`);
}
