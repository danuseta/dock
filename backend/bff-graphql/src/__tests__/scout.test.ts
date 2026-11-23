import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Blackboard } from '../integrations/blackboard';
import { ScoutRunner, parseScoutLine, readScout } from '../integrations/scout';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'scout-'));
  const put = (key: string, body: string, at?: Date) => {
    const file = path.join(root, key, 'materials', 'contract.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    if (at) utimesSync(file, at, at);
  };
  return { root, put, board: new Blackboard(root, path.join(root, 'no-sprints')), done: () => rmSync(root, { recursive: true, force: true }) };
}

test('parseScoutLine reads the light and full variants, with or without the Scout prefix', () => {
  assert.deepStrictEqual(parseScoutLine('Scout: FE · ~3 files · no contract change → light'), { line: 'Scout: FE · ~3 files · no contract change → light', repos: 'FE', files: 3, contractChange: false, mode: 'light' });
  assert.deepStrictEqual(parseScoutLine('BE + FE · ~9 files · contract change → full'), { line: 'BE + FE · ~9 files · contract change → full', repos: 'BE + FE', files: 9, contractChange: true, mode: 'full' });
  assert.strictEqual(parseScoutLine('Scout: FE · ~1 file · no contract change -> light')?.files, 1);
  assert.strictEqual(parseScoutLine('Scout: FE · ~2 files · contract change: AC 3 → full')?.contractChange, true);
  assert.strictEqual(parseScoutLine('mode: light'), null);
  assert.strictEqual(parseScoutLine('Scout: FE · ~3 files · no contract change'), null);
});

test('readScout takes the last Scout line of the contract file and its time; a missing file or line is null', async () => {
  const { put, board, done } = fixture();
  try {
    put('QRD-1', '# Contract\nScout: BE · ~8 files · contract change → full\r\nnotes\r\nScout: FE · ~3 files · no contract change → light\n', new Date('2026-11-18T08:00:00Z'));
    put('QRD-2', '# Contract\nno scout here\n');
    const scout = await readScout(board, 'QRD-1');
    assert.deepStrictEqual(scout, { line: 'Scout: FE · ~3 files · no contract change → light', repos: 'FE', files: 3, contractChange: false, mode: 'light', at: '2026-11-18T08:00:00.000Z' });
    assert.strictEqual(await readScout(board, 'QRD-2'), null);
    assert.strictEqual(await readScout(board, 'QRD-3'), null);
  } finally {
    done();
  }
});

test('runScout starts one scout per ticket until its line lands or the time is up', async () => {
  const { put, board, done } = fixture();
  try {
    let clock = Date.parse('2026-11-18T08:00:00Z');
    const opened: Array<[string, string]> = [];
    let fail = false;
    const runner = new ScoutRunner(board, async (key, prompt) => { if (fail) throw new Error('No slot'); opened.push([key, prompt]); return 's1'; }, () => clock);

    assert.strictEqual(await runner.run('QRD-1'), true);
    assert.match(opened[0][1], /sous-explorer/);
    assert.match(opened[0][1], /QRD-1/);
    assert.strictEqual(await runner.run('QRD-1'), false, 'a second click while it runs opens nothing');
    assert.strictEqual(await runner.running('QRD-1'), true);
    assert.strictEqual(await runner.run('QRD-2'), true, 'another ticket is not blocked');
    assert.strictEqual(opened.length, 2);

    clock += 60_000;
    put('QRD-1', 'Scout: FE · ~3 files · no contract change → light\n', new Date(clock));
    assert.strictEqual(await runner.running('QRD-1'), false, 'the new line ends the run');
    assert.strictEqual(await runner.run('QRD-1'), true);

    clock += 16 * 60_000;
    assert.strictEqual(await runner.running('QRD-2'), false, 'a scout that never wrote a line stops counting as running');

    fail = true;
    await assert.rejects(runner.run('QRD-3'), /No slot/);
    assert.strictEqual(await runner.running('QRD-3'), false, 'a refused session does not block the ticket');
  } finally {
    done();
  }
});
