import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SKILL_NAME } from './auto-review';

/** Where the Claude sessions read skills from: the config folder the kit sets, and the home one. */
export const defaultSkillDirs = () => [process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'skills') : null, path.join(os.homedir(), '.claude', 'skills')].filter((dir): dir is string => Boolean(dir));

/** The names of the skills in those folders, sorted: a folder with a SKILL.md and a name Settings accepts. A missing folder is skipped. */
export async function installedSkills(dirs: string[] = defaultSkillDirs()): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of [...new Set(dirs)]) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!SKILL_NAME.test(entry.name) || names.has(entry.name) || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      if ((await stat(path.join(dir, entry.name, 'SKILL.md')).catch(() => null))?.isFile()) names.add(entry.name);
    }
  }
  return [...names].sort();
}
