import test from 'node:test';
import assert from 'node:assert/strict';
import { compareStoryboards, flowsOf, literalOf, parseStoryboard } from '../integrations/storyboard-flows';

const STORYBOARD_V1 = `<!doctype html><html><head><style>.x{color:red}</style></head><body><div id="root"></div>
<script>const ENGINE = { SCENARIOS: 'not this one' };</script>
<script>
const ROOT = [{ name: 'a' }];
const OPENING = (note) => [
  {t:'Root list', s:()=>pbList({rows:ROOT, ...(note ? {x: 1} : {})}), step:'klik \\u2018Layanan\\u2019'},
];
const FLOWS=[
/* ---------------- F1.1 ---------------- */
{id:'F1.1',kind:'major',title:'[Playbook] Buka folder & bikin skill',tickets:'QRD-1279 · QRD-1427',
 info:['Agent › Playbook (root).','klik "+" → Skill.','skill draft muncul.'],
 frames:[
  ...OPENING('shared'),
  {t:'Folder open',s:()=>pbList({rows:ROOT.filter((r)=>r.name!=='}'),ov:A('tree+:x','below',MENU("a, b"),-12)}),ring:['tree:x','1'],step:'klik \\'+\\'',
   notes:[['folder yg dibuka di-highlight; it\\'s the "open" one.','tree']]},
  {t:\`Created\`,s:()=>{ const re = /[)\\]}]/g; return re.test('x') ? 1 : 2; },notes:['skill baru tampil sbg DRAFT']}
 ],end:'done'},
{id:'F1.1b',kind:'minor',title:"Folder kosong",tickets:'QRD-1279',info:[],
 frames:[{t:'Empty folder',s:()=>pbList({}),step:'klik Add'}]},
{id:'F9.9',kind:'minor',title:'Not grouped',tickets:'',frames:[{t:'Alone'}]},
{id:'not-a-flow',title:'skipped',frames:[]}
];
const GROUPS=[
 {id:'F1.1',title:'Folder dari tree',flows:['F1.1','F1.1b']}
];
const SCENARIOS=[
 {n:1,title:'Organise the Playbook library',flows:FLOWS,groups:GROUPS}
];
</script></body></html>`;

const STORYBOARD_V2 = STORYBOARD_V1.replace("{t:'Empty folder',s:()=>pbList({}),step:'klik Add'}", "{t:'Empty folder',s:()=>pbList({}),step:'klik Add skill'}");

test('flows are read from the script source with their frames, code values skipped', () => {
  const scenarios = parseStoryboard(STORYBOARD_V1);
  assert.equal(scenarios.length, 1);
  assert.deepEqual([scenarios[0].n, scenarios[0].title], [1, 'Organise the Playbook library']);
  assert.deepEqual(scenarios[0].groups.map((group) => [group.title, group.flows.map((flow) => flow.id)]), [['Folder dari tree', ['F1.1', 'F1.1b']], ['Other', ['F9.9']]]);
  const [flow, empty] = flowsOf(scenarios);
  assert.deepEqual(flow.tickets, ['QRD-1279', 'QRD-1427']);
  assert.deepEqual(flow.info, ['Agent › Playbook (root).', 'klik "+" → Skill.', 'skill draft muncul.']);
  assert.deepEqual(flow.frames, [
    { title: 'Root list', step: 'klik ‘Layanan’', notes: [] },
    { title: 'Folder open', step: "klik '+'", notes: ['folder yg dibuka di-highlight; it\'s the "open" one.'] },
    { title: 'Created', step: null, notes: ['skill baru tampil sbg DRAFT'] },
  ]);
  assert.deepEqual([empty.id, empty.title, empty.frames.length], ['F1.1b', 'Folder kosong', 1]);
});

test('only a declaration is read, never a key with the same name', () => {
  assert.equal(literalOf('const A = { SCENARIOS: 1 };', 'SCENARIOS'), undefined);
  assert.deepEqual(parseStoryboard('<html><body>no storyboard</body></html>'), []);
});

test('a reworded frame marks its flow and frame changed; the first version marks nothing', () => {
  const first = compareStoryboards(null, parseStoryboard(STORYBOARD_V1));
  assert.deepEqual(first.changed, []);
  assert.ok(flowsOf(parseStoryboard(STORYBOARD_V1)).length > 0);

  const next = compareStoryboards(parseStoryboard(STORYBOARD_V1), parseStoryboard(STORYBOARD_V2));
  assert.deepEqual(next.changed, ['F1.1b']);
  assert.deepEqual(next.tickets, { 'F1.1b': ['QRD-1279'] });
  const flows = next.scenarios[0].groups.flatMap((group) => group.flows);
  assert.deepEqual(flows.map((flow) => [flow.id, flow.changed]), [['F1.1', false], ['F1.1b', true], ['F9.9', false]]);
  assert.deepEqual(flows[1].frames, [{ index: 0, title: 'Empty folder', step: 'klik Add skill', changed: true }]);

  const removed = compareStoryboards(parseStoryboard(STORYBOARD_V2), parseStoryboard(STORYBOARD_V2.replace("{id:'F9.9',kind:'minor',title:'Not grouped',tickets:'',frames:[{t:'Alone'}]},", '')));
  assert.deepEqual(removed.changed, ['F9.9']);
});
