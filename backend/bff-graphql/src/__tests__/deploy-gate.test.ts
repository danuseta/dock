import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deployGate, parseDeployWorkflows, type DeployGateDeps, type GatePull, type WorkflowRun } from '../integrations/deploy-gate';

const BE = { owner: 'qonekid', repo: 'ms-admin-worker-backend' };
const FE = { owner: 'qonekid', repo: 'ms-client-dashboard-frontend' };
const run = (headSha: string, status: string, conclusion: string | null, createdAt: string, updatedAt = createdAt): WorkflowRun => ({ headSha, status, conclusion, createdAt, updatedAt, url: `https://github.com/run/${headSha}` });

function deps(options: { pulls: GatePull[]; merged: Record<number, { sha: string | null; at: string | null }>; runs: Record<string, WorkflowRun[]>; contains?: Record<string, string[]>; workflows?: Record<string, string>; bases?: Record<number, string> }): DeployGateDeps {
  const workflows = options.workflows ?? { 'qonekid/ms-admin-worker-backend': 'deploy.uat.yml', 'qonekid/ms-client-dashboard-frontend': 'deploy-dev.yml' };
  return {
    pulls: async () => options.pulls,
    pull: async (_o, _r, number) => ({ merged: Boolean(options.merged[number]?.sha), mergeSha: options.merged[number]?.sha ?? null, mergedAt: options.merged[number]?.at ?? null, base: options.bases?.[number] ?? 'develop' }),
    workflow: async (fullName) => workflows[fullName] ?? null,
    runs: async (_o, repo) => options.runs[repo] ?? [],
    contains: async (_o, _r, base, head) => base === head || (options.contains?.[base] ?? []).includes(head),
  };
}

test('QRD-1292 on 4 Nov: FE deployed, BE still deploying, so the ticket is not ready (QA started 14:32, BE deploy ended 14:55)', async () => {
  const d = deps({
    pulls: [{ ...FE, number: 1115, status: 'merged' }, { ...BE, number: 1342, status: 'merged' }],
    merged: { 1115: { sha: 'fe1115', at: '2026-11-04T14:28:07Z' }, 1342: { sha: '1f4cf12', at: '2026-11-04T14:32:25Z' } },
    runs: {
      'ms-client-dashboard-frontend': [run('fe1115', 'completed', 'success', '2026-11-04T14:28:10Z', '2026-11-04T14:30:56Z')],
      'ms-admin-worker-backend': [run('1f4cf12', 'in_progress', null, '2026-11-04T14:32:30Z')],
    },
  });
  const gate = await deployGate('QRD-1292', d);
  assert.equal(gate.ready, false);
  assert.deepEqual(gate.repos.map((r) => r.state), ['deployed', 'deploying']);
  assert.match(gate.summary, /ms-admin-worker-backend#1342 deploying/);
});

test('the same ticket at 14:55: both deployed, ready', async () => {
  const gate = await deployGate('QRD-1292', deps({
    pulls: [{ ...FE, number: 1115, status: 'merged' }, { ...BE, number: 1342, status: 'merged' }],
    merged: { 1115: { sha: 'fe1115', at: '2026-11-04T14:28:07Z' }, 1342: { sha: '1f4cf12', at: '2026-11-04T14:32:25Z' } },
    runs: {
      'ms-client-dashboard-frontend': [run('fe1115', 'completed', 'success', '2026-11-04T14:28:10Z')],
      'ms-admin-worker-backend': [run('1f4cf12', 'completed', 'success', '2026-11-04T14:32:30Z', '2026-11-04T14:55:14Z')],
    },
  }));
  assert.equal(gate.ready, true);
  assert.equal(gate.repos[1].finishedAt, '2026-11-04T14:55:14Z');
});

test('a later successful deploy that contains the merge counts, even when the merge commit\'s own run failed', async () => {
  const gate = await deployGate('QRD-1', deps({
    pulls: [{ ...BE, number: 7, status: 'merged' }],
    merged: { 7: { sha: 'aaa', at: '2026-11-09T05:44:00Z' } },
    runs: { 'ms-admin-worker-backend': [run('ccc', 'completed', 'success', '2026-11-09T07:20:33Z'), run('aaa', 'completed', 'failure', '2026-11-09T05:44:28Z')] },
    contains: { aaa: ['ccc'] },
  }));
  assert.equal(gate.ready, true);
  assert.equal(gate.repos[0].runUrl, 'https://github.com/run/ccc');
});

test('a failed deploy with no later success, an open pull request, no run yet, or no workflow set: not ready, and says why', async () => {
  const failed = await deployGate('QRD-2', deps({ pulls: [{ ...BE, number: 8, status: 'merged' }], merged: { 8: { sha: 'f', at: '2026-11-09T05:00:00Z' } }, runs: { 'ms-admin-worker-backend': [run('f', 'completed', 'failure', '2026-11-09T05:00:10Z')] } }));
  assert.equal(failed.repos[0].state, 'failed');
  const open = await deployGate('QRD-3', deps({ pulls: [{ ...FE, number: 9, status: 'open' }], merged: {}, runs: {} }));
  assert.equal(open.repos[0].state, 'not-merged');
  assert.equal(open.ready, false);
  const waiting = await deployGate('QRD-4', deps({ pulls: [{ ...BE, number: 10, status: 'merged' }], merged: { 10: { sha: 'w', at: '2026-11-09T05:00:00Z' } }, runs: {} }));
  assert.match(waiting.repos[0].detail, /has not started/);
  const unset = await deployGate('QRD-5', deps({ pulls: [{ ...BE, number: 11, status: 'merged' }], merged: { 11: { sha: 'u', at: null } }, runs: {}, workflows: {} }));
  assert.equal(unset.repos[0].state, 'unknown');
  assert.match(unset.repos[0].detail, /deployWorkflows/);
  assert.equal((await deployGate('QRD-6', deps({ pulls: [], merged: {}, runs: {} }))).ready, false);
});

test('a closed pull request does not block the gate; runs from before the merge do not count', async () => {
  const gate = await deployGate('QRD-7', deps({
    pulls: [{ ...BE, number: 12, status: 'closed' }, { ...FE, number: 13, status: 'merged' }],
    merged: { 13: { sha: 'm', at: '2026-11-09T06:00:00Z' } },
    runs: { 'ms-client-dashboard-frontend': [run('old', 'completed', 'success', '2026-11-09T04:00:00Z')] },
    contains: { m: ['old'] },
  }));
  assert.equal(gate.ready, false);
  assert.equal(gate.repos[1].state, 'deploying');
});

test('deployWorkflows setting: repo names are case-insensitive, junk is ignored', () => {
  assert.deepEqual(parseDeployWorkflows('{"Qonekid/MS-Admin-Worker-Backend":"deploy.uat.yml","bad":"x","o/r":""}'), { 'qonekid/ms-admin-worker-backend': 'deploy.uat.yml' });
  assert.deepEqual(parseDeployWorkflows('not json'), {});
  assert.deepEqual(parseDeployWorkflows(null), {});
});

test('a pull request merged into another ticket branch does not hold the gate (FE #1157 into feat/QRD-1296 on QRD-1292)', async () => {
  const gate = await deployGate('QRD-1292', deps({
    pulls: [{ ...FE, number: 1115, status: 'merged' }, { ...FE, number: 1157, status: 'merged' }],
    merged: { 1115: { sha: 'fe1115', at: '2026-11-04T14:28:07Z' }, 1157: { sha: 'stack', at: '2026-11-06T02:00:00Z' } },
    bases: { 1157: 'feat/QRD-1296-share-skill-view-use' },
    runs: { 'ms-client-dashboard-frontend': [run('fe1115', 'completed', 'success', '2026-11-04T14:28:10Z')] },
  }));
  assert.equal(gate.ready, true);
  assert.match(gate.repos[1].detail, /merged into feat\/QRD-1296/);
});
