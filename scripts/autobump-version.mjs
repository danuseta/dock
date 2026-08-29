#!/usr/bin/env node
/**
 * JIDIS CI/CD Monorepo Version Autobump Utility
 * Automatically synchronizes Semantic Versions across root, frontend, electron, all backend microservices, and AI documentation.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Identify all package target paths across the JIDIS architecture
const targetRelativePaths = [
  'package.json',
  'frontend/package.json',
  'electron/package.json',
  'backend/bff-graphql/package.json',
  'backend/jira-service/package.json',
  'backend/github-service/package.json',
  'backend/discord-service/package.json',
  'backend/storage-service/package.json'
];

const docPath = path.join(rootDir, 'dev-docs/ai/VERSION.md');

// 2. Read Root package.json to determine current baseline version
const rootPkgPath = path.join(rootDir, 'package.json');
let currentVersion = '1.0.0';
if (fs.existsSync(rootPkgPath)) {
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
  currentVersion = rootPkg.version || '1.0.0';
}

// 3. Determine Bump Type from arguments or CI/CD env
const arg = process.argv[2] || process.env.BUMP_TYPE || 'patch';
let newVersion = currentVersion;

// Helper to calculate new semver
function calculateVersion(oldVer, bumpType) {
  // If user provided a literal version string (e.g. "1.2.0"), use it directly
  if (/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(bumpType)) {
    return bumpType;
  }

  const match = oldVer.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) return '1.0.0';
  let [, major, minor, patch, prerelease] = match;
  major = parseInt(major, 10);
  minor = parseInt(minor, 10);
  patch = parseInt(patch, 10);

  if (bumpType.toLowerCase() === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bumpType.toLowerCase() === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    // Default to patch
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

newVersion = calculateVersion(currentVersion, arg);

console.log('================================================================================');
console.log(`🚀 JIDIS Monorepo Version Autobump: ${currentVersion} ➔ ${newVersion} (${arg.toUpperCase()})`);
console.log('================================================================================\n');

let successCount = 0;

// 4. Perform synchronized updates across all microservices and frontend packages
for (const relPath of targetRelativePaths) {
  const fullPath = path.join(rootDir, relPath);
  if (fs.existsSync(fullPath)) {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const pkg = JSON.parse(content);
      const oldPkgVersion = pkg.version || 'unknown';
      pkg.version = newVersion;

      // Preserve clean 2-space indentation and newline at EOF
      fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      console.log(` ✅ [Package] ${relPath.padEnd(42, ' ')} | ${oldPkgVersion} ➔ ${newVersion}`);
      successCount++;
    } catch (err) {
      console.error(` ❌ [Error] Failed updating ${relPath}:`, err.message);
    }
  } else {
    console.warn(` ⚠️ [Notice] Skipped ${relPath} (File not found yet in filesystem)`);
  }
}

// 5. Update dev-docs/ai/VERSION.md so documentation never goes out of sync!
if (fs.existsSync(docPath)) {
  try {
    let docContent = fs.readFileSync(docPath, 'utf-8');
    // Replace "Current Version: **X.Y.Z**" or "Current Version: X.Y.Z"
    if (/Current Version:\s*\**[^\s*]+\**/i.test(docContent)) {
      docContent = docContent.replace(
        /(Current Version:\s*\**)([^\s*]+)(\**)/i,
        `$1${newVersion}$3`
      );
    } else {
      docContent = `# Version\n\nCurrent Version: **${newVersion}**\n\n` + docContent;
    }
    fs.writeFileSync(docPath, docContent, 'utf-8');
    console.log(` ✅ [Docs AI] dev-docs/ai/VERSION.md               | Synchronized to **${newVersion}**`);
    successCount++;
  } catch (err) {
    console.error(` ❌ [Error] Failed updating dev-docs/ai/VERSION.md:`, err.message);
  }
}

console.log('\n================================================================================');
console.log(`✨ Autobump Completed Successfully on ${successCount} files! New Monorepo Version: v${newVersion}`);
console.log('================================================================================');

// 6. Export outputs for GitHub Actions Workflow environment
if (process.env.GITHUB_OUTPUT) {
  try {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `old_version=${currentVersion}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `new_version=${newVersion}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `git_tag=v${newVersion}\n`);
    console.log(`📦 Exported CI/CD GITHUB_OUTPUT environment variables (old_version, new_version, git_tag)`);
  } catch (e) {
    console.error(`⚠️ Could not write to GITHUB_OUTPUT:`, e.message);
  }
}
