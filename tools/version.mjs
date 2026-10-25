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

export function titlesOf(log) {
  return log.split('\x1e').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [subject, body = ''] = entry.split('\x1f');
    if (!/^Merge pull request /.test(subject)) return subject;
    return body.split('\n').map((line) => line.trim()).find(Boolean) ?? subject;
  });
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
  const log = git(['log', `${tag}..HEAD`, '--first-parent', '--reverse', '--format=%s%x1f%b%x1e']);
  return bumpVersion(tag.slice(1), titlesOf(log));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${currentVersion()}\n`);
}
