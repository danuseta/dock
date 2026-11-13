import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';
import type { MergeRead } from '../integrations/merge-state';
import { DEFAULT_WORKTREE_MERGED, OpsRulesInputError, parseWorktreeMerged, readWorktreeMerged, type WorktreeMerged } from '../integrations/ops-rules';
import { REFUSALS, Worktrees, parseWorktreeList, ticketOf, type WorktreeDeps } from '../integrations/worktrees';

const run = promisify(execFile);
// Everything lives in a temp folder: the worktrees are plain folders, git is faked, and wt.sh is a fake that only logs.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dock-worktrees-'));
const fwd = (value: string) => value.replace(/\\/g, '/');
const kitDir = fwd(path.join(tmp, 'kit'));
const root = fwd(path.join(tmp, 'projects'));
fs.mkdirSync(kitDir, { recursive: true });
fs.writeFileSync(path.join(kitDir, 'wt.sh'), [
  '#!/usr/bin/env bash',
  'echo "$*" >> "$(dirname "$0")/calls.log"',
  'case "$1" in',
  '  check) if [ -f "$2/.junction" ]; then echo "$2 node_modules: junction"; else echo "$2 node_modules: own"; fi;;',
  '  unlink) if [ -f "$2/.unlinkfail" ]; then echo "REFUSED: the junction at $2/node_modules is still there"; exit 2; fi; [ -f "$2/.unlinknoop" ] || rm -f "$2/.junction"; echo "node_modules: none";;',
  '  remove) if [ -f "$2/.refuse" ]; then echo "REFUSED: $2 has uncommitted or untracked files"; exit 2; fi; if [ -f "$2/.junction" ]; then echo "REFUSED: $2/node_modules is a junction into the main repo."; exit 2; fi; echo "removed $2";;',
  'esac',
].join('\n'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const calls = () => { try { return fs.readFileSync(path.join(kitDir, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
const resetCalls = () => fs.rmSync(path.join(kitDir, 'calls.log'), { force: true });
const wtDir = (name: string) => { const dir = fwd(path.join(root, '.worktrees', name)); fs.mkdirSync(dir, { recursive: true }); return dir; };

const porcelain = (main: string, items: Array<[string, string]>) => [`worktree ${main}\nHEAD aaa\nbranch refs/heads/main`, ...items.map(([dir, branch]) => `worktree ${dir}\nHEAD bbb\nbranch refs/heads/${branch}`)].join('\n\n') + '\n';

function setup(options: { merged?: string[]; dirty?: string[]; live?: string[]; servers?: string[]; rules?: Partial<WorktreeMerged>; now?: { t: Date }; failServers?: boolean } = {}) {
  const be = wtDir('QRD-1-be');
  const fe = wtDir('QRD-2-fe');
  const open = wtDir('QRD-3-be');
  const cache = new Map<string, unknown>();
  const deps: WorktreeDeps = {
    kitPaths: async () => ({ root, repos: { be: `${root}/ms-admin-worker-backend`, fe: `${root}/ms-client-dashboard-frontend` }, kitDir }),
    git: async (cwd, args) => {
      if (args[0] === 'worktree') return cwd.endsWith('backend') ? porcelain(cwd, [[be, 'feat/QRD-1-api'], [open, 'feat/QRD-3-open']]) : porcelain(cwd, [[fe, 'feat/QRD-2-page']]);
      if (args[0] === 'status') return (options.dirty ?? []).includes(cwd) ? ' M src/app.ts\n' : '';
      throw new Error(`unexpected git ${args.join(' ')}`);
    },
    wt: async (dir, args) => {
      try {
        const { stdout } = await run('bash', [`${dir}/wt.sh`, ...args]);
        return { code: 0, output: stdout };
      } catch (error: any) {
        return { code: error.code ?? 1, output: `${error.stdout ?? ''}` };
      }
    },
    mergeStates: async (keys) => new Map(keys.map((key): [string, MergeRead] => [key, { merge: (options.merged ?? ['QRD-1', 'QRD-2']).includes(key) ? 'merged' : 'open', pulls: [] }])),
    liveSessions: async () => ({ keys: new Set(options.live ?? []), dirs: [] }),
    devServerDirs: async () => { if (options.failServers) throw new Error('ss failed'); return options.servers ?? []; },
    rules: async () => ({ ...DEFAULT_WORKTREE_MERGED, ...options.rules }),
    cacheGet: async (key) => cache.get(key) ?? null,
    cacheSet: async (key, value) => { cache.set(key, value); },
    now: () => options.now?.t ?? new Date('2026-11-13T01:00:00.000Z'),
  };
  resetCalls();
  return { service: new Worktrees(deps), be, fe, open, cache };
}

describe('worktrees', () => {
  it('lists every linked worktree per repo, not the main clone, with its ticket and merge state', async () => {
    const { service, be, fe, open } = setup();
    const list = await service.list();
    assert.equal(list.error, null);
    assert.deepEqual(list.rows.map((row) => [row.repo, row.path, row.ticketKey, row.merge]), [['be', be, 'QRD-1', 'merged'], ['be', open, 'QRD-3', 'open'], ['fe', fe, 'QRD-2', 'merged']]);
    assert.deepEqual(list.rows.map((row) => row.refusals), [[], [REFUSALS.notMerged], []]);
    assert.equal(list.mode, 'notify');
    assert.deepEqual(calls(), [], 'listing never calls wt.sh');
  });

  it('parses the porcelain list and finds the ticket in the branch or the folder', () => {
    assert.deepEqual(parseWorktreeList('worktree /p/main\nHEAD a\nbranch refs/heads/main\n\nworktree /p/x\nHEAD b\ndetached\n\nworktree /p/bare\nbare\n'), [{ path: '/p/x', branch: null, head: 'b', bare: false }]);
    assert.equal(ticketOf('feat/qrd-12-x', '/p/a'), 'QRD-12');
    assert.equal(ticketOf(null, '/p/.worktrees/QRD-9-fe'), 'QRD-9');
    assert.equal(ticketOf('main', '/p/tmp'), null);
  });

  it('removes a merged clean worktree through wt.sh check, then wt.sh remove, and keeps a history', async () => {
    const { service, be } = setup();
    const results = await service.clean([be]);
    assert.deepEqual(results.map((result) => [result.path, result.ok]), [[be, true]]);
    assert.deepEqual(calls(), [`check ${be}`, `remove ${be}`]);
    const history = (await service.list()).history;
    assert.deepEqual(history.map((item) => [item.path, item.ok, item.by]), [[be, true, 'owner']]);
  });

  for (const [name, options, reason] of [
    ['local changes', (dirs: Record<string, string>) => ({ dirty: [dirs.be] }), REFUSALS.dirty],
    ['a live session', () => ({ live: ['QRD-1'] }), REFUSALS.session],
    ['a dev server in it', (dirs: Record<string, string>) => ({ servers: [`${dirs.be}/packages/api`] }), REFUSALS.devServer],
    ['a dev server list that cannot be read', () => ({ failServers: true }), REFUSALS.devServer],
    ['a ticket not merged', () => ({ merged: ['QRD-2'] }), REFUSALS.notMerged],
  ] as const) {
    it(`refuses with ${name} and touches nothing`, async () => {
      const dirs = setup();
      const { service, be } = setup(options({ be: dirs.be }));
      const [result] = await service.clean([be]);
      assert.equal(result.ok, false);
      assert.match(result.output, new RegExp(`^REFUSED: .*${reason}`));
      assert.deepEqual(calls(), [], 'wt.sh is not called');
      assert.ok(fs.existsSync(be));
    });
  }

  it('refuses a path DOCK did not list, and stops when wt.sh itself refuses', async () => {
    const { service, fe } = setup();
    const [unknown] = await service.clean([fwd(path.join(tmp, 'elsewhere'))]);
    assert.equal(unknown.output, `REFUSED: ${REFUSALS.unknown}`);
    assert.deepEqual(calls(), []);
    fs.writeFileSync(path.join(fe, '.refuse'), '');
    const [refused] = await service.clean([fe]);
    assert.equal(refused.ok, false);
    assert.match(refused.output, /REFUSED: .*uncommitted/);
    assert.deepEqual(calls(), [`check ${fe}`, `remove ${fe}`]);
    fs.rmSync(path.join(fe, '.refuse'));
  });

  it('unlinks a node_modules junction with wt.sh unlink, checks again, then removes, and records the unlink', async () => {
    const { service, fe } = setup();
    fs.writeFileSync(path.join(fe, '.junction'), '');
    const [result] = await service.clean([fe]);
    assert.equal(result.ok, true);
    assert.equal(result.unlinked, true);
    assert.deepEqual(calls(), [`check ${fe}`, `unlink ${fe}`, `check ${fe}`, `remove ${fe}`]);
    const [item] = (await service.list()).history;
    assert.deepEqual([item.path, item.ok, item.unlinked], [fe, true, true]);
  });

  it('refuses and never removes when wt.sh unlink fails, or the junction is still there after it', async () => {
    const { service, fe } = setup();
    fs.writeFileSync(path.join(fe, '.junction'), '');
    fs.writeFileSync(path.join(fe, '.unlinkfail'), '');
    const [failed] = await service.clean([fe]);
    assert.equal(failed.ok, false);
    assert.match(failed.output, /REFUSED: the junction/);
    assert.deepEqual(calls(), [`check ${fe}`, `unlink ${fe}`]);
    fs.rmSync(path.join(fe, '.unlinkfail'));
    resetCalls();
    fs.writeFileSync(path.join(fe, '.unlinknoop'), '');
    const [still] = await service.clean([fe]);
    assert.equal(still.ok, false);
    assert.match(still.output, /REFUSED: .*still a junction after wt.sh unlink/);
    assert.deepEqual(calls(), [`check ${fe}`, `unlink ${fe}`, `check ${fe}`]);
    fs.rmSync(path.join(fe, '.unlinknoop'));
    fs.rmSync(path.join(fe, '.junction'));
  });

  it('auto mode: once a WIB day from 07:00, only worktrees seen merged for the set days, with the same checks', async () => {
    const clock = { t: new Date('2026-11-10T01:00:00.000Z') };
    const { service, be, fe } = setup({ rules: { mode: 'auto', days: 3 }, now: clock, dirty: [] });
    await service.list();
    assert.deepEqual(await service.autoTick(), [], 'seen merged today, not yet old enough');
    clock.t = new Date('2026-11-13T01:00:00.000Z');
    const results = await service.autoTick();
    assert.deepEqual(results.map((result) => [result.path, result.ok]).sort(), [[be, true], [fe, true]].sort());
    assert.ok(!calls().some((line) => line.includes('QRD-3')), 'the open one is never sent to wt.sh');
    resetCalls();
    assert.deepEqual(await service.autoTick(), [], 'once a day');
    const history = (await service.list()).history;
    assert.ok(history.every((item) => item.by === 'auto'));
  });

  it('auto mode does nothing before 07:00 WIB, in notify mode or when off', async () => {
    assert.deepEqual(await setup({ rules: { mode: 'auto', days: 1 }, now: { t: new Date('2026-11-12T23:00:00.000Z') } }).service.autoTick(), []);
    assert.deepEqual(await setup({ rules: { mode: 'notify' } }).service.autoTick(), []);
    assert.deepEqual(await setup({ rules: { mode: 'off' } }).service.autoTick(), []);
    assert.deepEqual(calls(), []);
  });

  it('the rule defaults to notify, 3 days, and refuses wrong values', () => {
    assert.deepEqual(readWorktreeMerged(null), { mode: 'notify', days: 3 });
    assert.deepEqual(parseWorktreeMerged('{"mode":"auto","days":7}'), { mode: 'auto', days: 7 });
    assert.throws(() => parseWorktreeMerged('{"mode":"delete"}'), OpsRulesInputError);
    assert.throws(() => parseWorktreeMerged('{"days":0}'), OpsRulesInputError);
    assert.deepEqual(readWorktreeMerged('{"days":"x"}'), DEFAULT_WORKTREE_MERGED);
  });
});
