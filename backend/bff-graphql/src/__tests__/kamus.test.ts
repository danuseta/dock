import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Blackboard } from '../integrations/blackboard';
import { KAMUS_FILE, KamusInputError, MAX_KAMUS_ROWS, parseKamus, readKamus, saveKamus, serializeKamus, validateKamus, type KamusInput } from '../integrations/kamus';
import { protectedMutations, protectedQueries } from '../resolvers';

const OWNER_FILE = `# Kamus pengucapan

Daftar ini dibaca skill demo-video: tulisan di kiri diucapkan seperti kolom kanan.
Satu baris per kata.

## Istilah produk

| Tulisan | Dibaca |
|---|---|
| \`Qonflo\` | konflo |
| DOCK | dok |
| Playbook | pleibuk |

## Singkatan

| Tulisan | Dibaca |
| --- | --- |
| AC | a ce |
| PR | pi ar |

## Nama orang

| Tulisan | Dibaca |
| :-- | :-- |
| Danu | da nu |
`;

const board = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kamus-'));
  return { root, board: new Blackboard(root, path.join(root, 'boards')), done: () => rm(root, { recursive: true, force: true }) };
};
const input = (over: Partial<KamusInput> = {}): KamusInput => ({ intro: 'Intro line.', sections: [{ title: 'A', rows: [{ written: 'DOCK', spoken: 'dok' }] }], ...over });
const refuses = (change: Partial<KamusInput>, message: RegExp) => assert.throws(() => validateKamus(input(change)), (error: unknown) => error instanceof KamusInputError && message.test(error.message));

test('the owner file parses to its intro and three sections, with backticks stripped and header and separators skipped', () => {
  const parsed = parseKamus(OWNER_FILE);
  assert.equal(parsed.intro, 'Daftar ini dibaca skill demo-video: tulisan di kiri diucapkan seperti kolom kanan.\nSatu baris per kata.');
  assert.deepEqual(parsed.sections.map((section) => [section.title, section.rows.length]), [['Istilah produk', 3], ['Singkatan', 2], ['Nama orang', 1]]);
  assert.deepEqual(parsed.sections[0].rows[0], { written: 'Qonflo', spoken: 'konflo' });
});

test('it reads the same rows tts.py load_kamus reads: every table row of the file, in order', () => {
  const flat = parseKamus(OWNER_FILE).sections.flatMap((section) => section.rows.map((row) => [row.written, row.spoken]));
  assert.deepEqual(flat, [['Qonflo', 'konflo'], ['DOCK', 'dok'], ['Playbook', 'pleibuk'], ['AC', 'a ce'], ['PR', 'pi ar'], ['Danu', 'da nu']]);
  assert.deepEqual(parseKamus('| Written | Spoken |\n|---|---|\n| a | b |\n| c |  |\n|  | d |').sections, [{ title: '', rows: [{ written: 'a', spoken: 'b' }] }]);
});

test('a file without sections is one untitled section with all its rows; no text is an empty list', () => {
  const parsed = parseKamus('# Kamus\n\nIntro.\n\n| Tulisan | Dibaca |\n|---|---|\n| a | b |\n| c | d |\n');
  assert.deepEqual(parsed, { intro: 'Intro.', sections: [{ title: '', rows: [{ written: 'a', spoken: 'b' }, { written: 'c', spoken: 'd' }] }] });
  assert.deepEqual(parseKamus(''), { intro: '', sections: [] });
});

test('parse, serialize and parse again gives the same list, and the file text is the H1, intro, then a titled table per section', () => {
  const parsed = parseKamus(OWNER_FILE);
  const text = serializeKamus(validateKamus(parsed), 'Kamus pengucapan');
  assert.deepEqual(parseKamus(text), parsed);
  assert.equal(text, `# Kamus pengucapan

${parsed.intro}

## Istilah produk

| Tulisan | Dibaca |
| --- | --- |
| Qonflo | konflo |
| DOCK | dok |
| Playbook | pleibuk |

## Singkatan

| Tulisan | Dibaca |
| --- | --- |
| AC | a ce |
| PR | pi ar |

## Nama orang

| Tulisan | Dibaca |
| --- | --- |
| Danu | da nu |
`);
  assert.equal(serializeKamus(parseKamus(text), 'Kamus pengucapan'), text, 'writing twice changes nothing');
});

test('cells are trimmed, and every refusal names the section and row', () => {
  assert.deepEqual(validateKamus(input({ sections: [{ title: ' A ', rows: [{ written: '  DOCK ', spoken: ' dok  ' }] }] })).sections, [{ title: 'A', rows: [{ written: 'DOCK', spoken: 'dok' }] }]);
  refuses({ sections: [{ title: 'A', rows: [{ written: 'a|b', spoken: 'x' }] }] }, /Section "A", row 1: written cannot hold the \| character/);
  refuses({ sections: [{ title: 'A', rows: [{ written: 'a', spoken: 'x\ny' }] }] }, /row 1: spoken must be one line/);
  refuses({ sections: [{ title: 'A', rows: [{ written: 'a', spoken: 'x' }, { written: '  ', spoken: 'x' }] }] }, /row 2: written is empty/);
  refuses({ sections: [{ title: 'A', rows: [{ written: 'a', spoken: '' }] }] }, /spoken is empty/);
  refuses({ sections: [{ title: 'A', rows: [{ written: 'a'.repeat(81), spoken: 'x' }] }] }, /written is at most 80 characters/);
  refuses({ sections: [{ title: 'A', rows: [{ written: 'a', spoken: 'x'.repeat(81) }] }] }, /spoken is at most 80 characters/);
  assert.equal(validateKamus(input({ sections: [{ title: 'A', rows: [{ written: 'a'.repeat(80), spoken: 'x'.repeat(80) }] }] })).sections[0].rows.length, 1);
  refuses({ sections: [{ title: 'A', rows: [{ written: 'a`b', spoken: 'x' }] }] }, /cannot hold backticks/);
  refuses({ sections: [{ title: 'A', rows: [{ written: 'Tulisan', spoken: 'x' }] }] }, /reads as a table header/);
  refuses({ sections: [{ title: 'A', rows: [{ written: '---', spoken: 'x' }] }] }, /reads as a table header/);
});

test('a written form is unique across the whole file, ignoring case', () => {
  refuses({ sections: [{ title: 'A', rows: [{ written: 'DOCK', spoken: 'dok' }] }, { title: 'B', rows: [{ written: 'dock', spoken: 'dok' }] }] }, /Section "B", row 1: "dock" is already in the list \(Section "A", row 1\)/);
  refuses({ sections: [{ title: 'A', rows: [{ written: 'x', spoken: '1' }, { written: 'X', spoken: '2' }] }] }, /row 2: "X" is already in the list/);
});

test('at most 500 rows, titles on every section once there are several, and an intro that cannot pose as a table or heading', () => {
  const rows = Array.from({ length: MAX_KAMUS_ROWS }, (_, index) => ({ written: `w${index}`, spoken: 's' }));
  assert.equal(validateKamus(input({ sections: [{ title: 'A', rows }] })).sections[0].rows.length, 500);
  refuses({ sections: [{ title: 'A', rows: [...rows, { written: 'more', spoken: 's' }] }] }, /at most 500 rows; it has 501/);
  refuses({ sections: [{ title: 'A', rows: [] }, { title: ' ', rows: [] }] }, /Section 2: give the section a title/);
  assert.equal(validateKamus(input({ sections: [{ title: '', rows: [{ written: 'a', spoken: 'b' }] }] })).sections.length, 1);
  refuses({ intro: 'ok\n| a | b |' }, /intro cannot start a line with/);
  refuses({ intro: '## sneaky' }, /intro cannot start a line with/);
  refuses({ sections: [{ title: 'A\nB', rows: [] }] }, /the title is one line/);
  refuses({ sections: [{ title: 'x'.repeat(81), rows: [] }] }, /the title is at most 80/);
});

test('saving rewrites the file at the root keeping its H1, through a temp file that does not stay behind', async () => {
  const { root, board: bb, done } = await board();
  try {
    assert.deepEqual(await readKamus(bb), { exists: false, intro: '', sections: [] });
    await writeFile(path.join(root, KAMUS_FILE), OWNER_FILE.replace('# Kamus pengucapan', '# Kamus suara'));
    const saved = await saveKamus(bb, input({ intro: 'New intro.', sections: [{ title: 'Satu', rows: [{ written: 'Qonflo', spoken: 'konflo' }] }, { title: 'Dua', rows: [] }] }));
    assert.deepEqual(saved, { exists: true, intro: 'New intro.', sections: [{ title: 'Satu', rows: [{ written: 'Qonflo', spoken: 'konflo' }] }, { title: 'Dua', rows: [] }] });
    const text = await readFile(path.join(root, KAMUS_FILE), 'utf8');
    assert.match(text, /^# Kamus suara\n\nNew intro\.\n\n## Satu\n\n\| Tulisan \| Dibaca \|\n\| --- \| --- \|\n\| Qonflo \| konflo \|\n\n## Dua\n/);
    assert.deepEqual((await readdir(root)).filter((name) => name !== KAMUS_FILE), [], 'no temp file is left');
  } finally {
    await done();
  }
});

test('a save that fails changes nothing and leaves no temp file; a refused input never touches the file', async () => {
  const { root, board: bb, done } = await board();
  try {
    await writeFile(path.join(root, KAMUS_FILE), OWNER_FILE);
    await assert.rejects(saveKamus(bb, input({ sections: [{ title: 'A', rows: [{ written: 'a|b', spoken: 'x' }] }] })), KamusInputError);
    assert.equal(await readFile(path.join(root, KAMUS_FILE), 'utf8'), OWNER_FILE);
    await rm(path.join(root, KAMUS_FILE));
    await mkdir(path.join(root, KAMUS_FILE));
    await assert.rejects(bb.writeRootText(KAMUS_FILE, 'x'));
    assert.deepEqual(await readdir(root), [KAMUS_FILE], 'the failed rename removed its temp file');
    await assert.rejects(bb.writeRootText('other.md', 'x'), /Not a root file/);
  } finally {
    await done();
  }
});

test('the list is read and written behind the PIN like the other protected calls', () => {
  assert.ok((protectedQueries as readonly string[]).includes('kamus'));
  assert.ok((protectedMutations as readonly string[]).includes('saveKamus'));
});
