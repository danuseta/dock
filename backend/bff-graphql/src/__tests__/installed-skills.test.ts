import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installedSkills } from '../integrations/installed-skills';

test('the installed skills are the folders with a SKILL.md in either skills folder, once each, sorted; a missing folder is skipped', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'dock-skills-'));
  try {
    const config = path.join(base, 'config', 'skills');
    const home = path.join(base, 'home', 'skills');
    for (const [dir, name] of [[config, 'review-message'], [config, 'sous'], [home, 'my-reply'], [home, 'sous'], [home, 'Bad Name'], [home, 'no-skill-file']] as const) {
      await mkdir(path.join(dir, name), { recursive: true });
      if (name !== 'no-skill-file') await writeFile(path.join(dir, name, 'SKILL.md'), '# skill');
    }
    await writeFile(path.join(home, 'loose.md'), 'not a skill');
    assert.deepEqual(await installedSkills([config, home, path.join(base, 'missing')]), ['my-reply', 'review-message', 'sous']);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
