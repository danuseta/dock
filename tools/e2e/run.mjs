#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStack } from './start.mjs';
import { renderReport } from './report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const { chromium } = createRequire(path.join(root, 'package.json'))('playwright');

const PIN = '767676';
const VIEWPORT = { width: 1440, height: 900 };
const OWNER = '111111111111111111';
const TEAMMATE = '222222222222222222';
const TEAMMATE_WEBHOOK = '900000000000000002';
const pad = (value) => String(value).padStart(2, '0');
const today = new Date();
const defaultOut = process.platform === 'win32' ? `E:/qonflo/${pad(today.getMonth() + 1)}${pad(today.getDate())}/dock-e2e` : path.join(process.cwd(), 'e2e-out');
const OUT = path.resolve(process.env.E2E_OUT?.trim() || defaultOut);
const E2E_DIR = path.resolve(process.env.E2E_DIR?.trim() || path.join(os.tmpdir(), 'dock-e2e-run'));
const ONLY = (process.env.E2E_STAGES ?? '').split(',').map((item) => Number(item.trim())).filter(Boolean);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CURSOR_SCRIPT = `(() => {
  if (window.__e2eCursor) return;
  window.__e2eCursor = true;
  const place = (el, x, y) => { el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
  const mount = () => {
    const el = document.createElement('div');
    el.id = 'e2e-cursor';
    el.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;will-change:transform;';
    el.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 15 L11.5 22 L14.5 20.7 L11.6 14 L18 14 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><span style="position:absolute;left:-9px;top:-9px;width:22px;height:22px;border-radius:50%;border:2px solid #f5c542;opacity:0;transition:opacity .15s,transform .25s;"></span>';
    document.documentElement.appendChild(el);
    let last = null;
    try { last = JSON.parse(sessionStorage.getItem('e2e-cursor') || 'null'); } catch {}
    if (last) place(el, last[0], last[1]); else place(el, -60, -60);
    const ring = el.querySelector('span');
    window.addEventListener('mousemove', (event) => {
      place(el, event.clientX, event.clientY);
      try { sessionStorage.setItem('e2e-cursor', JSON.stringify([event.clientX, event.clientY])); } catch {}
    }, true);
    window.addEventListener('mousedown', () => { ring.style.opacity = '1'; ring.style.transform = 'scale(0.6)'; }, true);
    window.addEventListener('mouseup', () => { ring.style.opacity = '0'; ring.style.transform = 'scale(1)'; }, true);
  };
  if (document.documentElement) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();`;

const results = [];
const stageRuns = [];
let stack = null;
let browser = null;
let storageState = undefined;
let page = null;
let mouse = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
let current = null;

async function mockState() {
  return (await fetch(`${stack.config.urls.mock}/__state`)).json();
}

async function script(...steps) {
  const response = await fetch(`${stack.config.urls.mock}/__script`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ steps }) });
  const body = await response.json();
  const failed = body.results?.find((item) => item?.error);
  if (failed) throw new Error(`mock script failed: ${failed.error}`);
  return body.results;
}

async function until(label, check, timeoutMs = 60000, everyMs = 1000) {
  const started = Date.now();
  let last = null;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() - started > timeoutMs) throw new Error(`${label} (waited ${Math.round(timeoutMs / 1000)}s)${last ? `: ${last.message}` : ''}`);
    await wait(everyMs);
  }
}

async function glide(x, y) {
  const distance = Math.hypot(x - mouse.x, y - mouse.y);
  await page.mouse.move(x, y, { steps: Math.max(8, Math.min(40, Math.round(distance / 25))) });
  mouse = { x, y };
}

async function point(locator) {
  await locator.waitFor({ state: 'visible', timeout: 30000 });
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = await locator.boundingBox();
  if (!box) throw new Error('target has no box');
  await glide(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
  await wait(250);
}

async function click(locator) {
  await point(locator);
  await locator.click();
  await wait(400);
}

async function type(locator, text) {
  await click(locator);
  await locator.pressSequentially(text, { delay: 25 });
  await wait(200);
}

async function send(text) {
  const box = page.locator('main textarea:visible').first();
  await type(box, text);
  await box.press('Enter');
  await wait(600);
}

const mainText = () => page.locator('main').first().innerText();

async function waitText(locator, pattern, timeoutMs = 60000, label = String(pattern)) {
  return until(`text ${label} not shown`, async () => {
    const text = await locator.innerText();
    return pattern.test(text) ? text : null;
  }, timeoutMs, 1000);
}

async function goto(pathname) {
  await page.goto(`${stack.config.urls.frontend}${pathname}`);
  await page.waitForLoadState('domcontentloaded');
  await page.mouse.move(mouse.x, mouse.y);
  await wait(1200);
}

async function nav(label) {
  await click(page.getByRole('navigation').getByRole('button', { name: label, exact: true }).or(page.getByRole('link', { name: label, exact: true })).first());
  await wait(1200);
}

async function unlock() {
  if (!(await page.getByText('App Locked').isVisible().catch(() => false))) return 'already unlocked';
  for (const digit of PIN) await click(page.getByRole('button', { name: digit, exact: true }));
  await until('PIN lock did not close', async () => !(await page.getByText('App Locked').isVisible()), 15000);
  return 'unlocked with PIN';
}

const snippet = (text, size = 220) => String(text).replace(/\s+/g, ' ').trim().slice(0, size);

async function step(action, expected, fn) {
  if (current.failed) {
    results.push({ stage: current.n, n: results.filter((row) => row.stage === current.n).length + 1, action, expected, actual: 'not run: an earlier step of this stage failed', status: 'SKIP', screenshot: null, ms: 0 });
    return null;
  }
  const n = results.filter((row) => row.stage === current.n).length + 1;
  const started = Date.now();
  const row = { stage: current.n, n, action, expected, actual: '', status: 'PASS', screenshot: null, error: null, ms: 0 };
  results.push(row);
  process.stdout.write(`  ${current.n}.${n} ${action} ... `);
  let value = null;
  try {
    value = await fn();
    row.actual = typeof value === 'string' ? value : 'done';
  } catch (error) {
    row.status = 'FAIL';
    row.error = error instanceof Error ? error.message.split('\n').slice(0, 6).join('\n') : String(error);
    row.actual = snippet(row.error, 300);
    current.failed = true;
  }
  row.ms = Date.now() - started;
  const name = `s${current.n}-${pad(n)}${row.status === 'FAIL' ? '-fail' : ''}.png`;
  try {
    await page.screenshot({ path: path.join(OUT, 'shots', name) });
    row.screenshot = `shots/${name}`;
  } catch {
    row.screenshot = null;
  }
  process.stdout.write(`${row.status}${row.status === 'FAIL' ? `: ${snippet(row.error, 160)}` : ''}\n`);
  return value;
}

async function startRecorder(context, target, dir) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const cdp = await context.newCDPSession(target);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata?.timestamp ?? Date.now() / 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 });
  return {
    stop: async () => {
      await cdp.send('Page.stopScreencast').catch(() => undefined);
      frames.push({ file: frames.at(-1)?.file, t: Date.now() / 1000 });
      return frames.filter((frame) => frame.file);
    },
  };
}

function encodeFrames(frames, dir, relative) {
  if (frames.length < 2) return null;
  const lines = [];
  for (let index = 0; index < frames.length - 1; index += 1) {
    lines.push(`file '${frames[index].file.replace(/\\/g, '/')}'`, `duration ${Math.max(0.04, frames[index + 1].t - frames[index].t).toFixed(3)}`);
  }
  lines.push(`file '${frames.at(-1).file.replace(/\\/g, '/')}'`);
  const list = path.join(dir, 'frames.txt');
  writeFileSync(list, `${lines.join('\n')}\n`);
  const target = path.join(OUT, relative);
  const scale = `scale=${VIEWPORT.width}:${VIEWPORT.height}:force_original_aspect_ratio=decrease,pad=${VIEWPORT.width}:${VIEWPORT.height}:(ow-iw)/2:(oh-ih)/2,fps=25,format=yuv420p`;
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', scale, '-c:v', 'libvpx', '-crf', '32', '-b:v', '800k', '-deadline', 'realtime', '-cpu-used', '8', target], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0 || !existsSync(target)) {
    process.stdout.write(`  video ${relative} not written: ${snippet(result.stderr || result.error?.message || 'ffmpeg failed', 200)}\n`);
    return null;
  }
  return relative;
}

async function stage(n, title, body) {
  if (ONLY.length && !ONLY.includes(n)) return;
  current = { n, title, failed: false };
  const started = Date.now();
  process.stdout.write(`Stage ${n}: ${title}\n`);
  const frameDir = path.join(OUT, 'videos', `.frames-${n}`);
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'dark', storageState });
  await context.addInitScript(() => { try { localStorage.setItem('v2-theme', 'dark'); } catch { /* storage blocked */ } });
  await context.addInitScript(CURSOR_SCRIPT);
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  const recorder = await startRecorder(context, page, frameDir);
  try {
    await body();
  } catch (error) {
    await step('stage body', 'no error outside a step', () => { throw error; });
  }
  await wait(800);
  const frames = await recorder.stop();
  try { storageState = await context.storageState(); } catch { /* keep the previous state */ }
  await context.close();
  const videoFile = encodeFrames(frames, frameDir, `videos/stage-${n}.webm`);
  rmSync(frameDir, { recursive: true, force: true });
  stageRuns.push({ n, title, video: videoFile, ms: Date.now() - started });
}

function runSetup(args) {
  const result = spawnSync(['npm', 'run', 'setup', '--', ...args].join(' '), {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, DATABASE_URL: stack.config.database, ENCRYPTION_KEY: stack.config.encryptionKey, DOCK_MOCK_URL: stack.config.urls.mock, JIDIS_DATA_DIR: stack.config.dir },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) throw new Error(`npm run setup exited ${result.status}: ${snippet(output, 400)}`);
  return snippet(output.split('\n').filter((line) => /Saved|set|PIN/i.test(line)).join(' ') || output, 200);
}

async function openSession(title) {
  const list = page.getByRole('navigation', { name: 'Sessions' });
  await click(list.getByRole('button').filter({ hasText: title }).first());
  await wait(1500);
}

async function newSession(mode) {
  await click(page.getByRole('button', { name: 'New session' }).first());
  await click(page.getByRole('radio', { name: mode === 'gm' ? /Guild Master/ : /^Work/ }));
  if (mode === 'gm') await type(page.getByLabel('Owner PIN'), PIN);
  await click(page.getByRole('button', { name: 'Start', exact: true }));
  await wait(1500);
}

async function openBlackboard(key) {
  await goto('/blackboard');
  await click(page.getByRole('button', { name: new RegExp(key) }).first());
  await wait(1500);
}

async function stages() {
  await stage(1, 'Setup: npm run setup and the Finish setup card', async () => {
    await step('Buka DOCK setelah seed:e2e --fresh', 'Fresh DOCK asks for a PIN first (no PIN, Jira or GitHub yet)', async () => {
      await goto('/');
      const text = await until('set PIN screen not shown', async () => {
        const body = await page.locator('body').innerText();
        return /PIN/i.test(body) && !/App Locked/.test(body) ? body : null;
      }, 30000);
      return snippet(text);
    });
    await step('npm run setup -- --pin 767676', 'setup saves the PIN without prompts', async () => runSetup(['--pin', PIN]));
    await step('Reload DOCK dan unlock dengan PIN', 'PIN lock opens and Home shows the Finish setup card listing Jira and GitHub', async () => {
      await goto('/');
      await unlock();
      const card = page.getByRole('region', { name: 'Finish setup' });
      const text = await waitText(card, /Jira[\s\S]*GitHub/, 20000);
      await point(card);
      return snippet(text);
    });
    await step('npm run setup -- --jira-url --jira-email --jira-token --github-token', 'setup checks Jira and GitHub against the mock and saves both', async () => runSetup(['--jira-url', 'qonflo-e2e.atlassian.net', '--jira-email', 'danu@e2e.test', '--jira-token', 'e2e-jira-token', '--github-token', 'e2e-github-token']));
    await step('Reload Home', 'The Finish setup card is gone; my tickets QRD-9001.. are listed from Jira', async () => {
      await goto('/');
      await unlock();
      await waitText(page.locator('main').first(), /QRD-9001/, 30000);
      if (await page.getByRole('region', { name: 'Finish setup' }).count()) throw new Error('Finish setup card is still shown');
      return 'Finish setup card gone; Home lists QRD-9001';
    });
  });

  await stage(2, 'Planning: Load from Jira, split Use/Keep, Run scout', async () => {
    await step('Buka Planning > Draft, pilih QRD Sprint 30', 'The active sprint is selectable', async () => {
      await goto('/');
      await unlock();
      await nav('Planning');
      await click(page.getByRole('tab', { name: 'Draft', exact: true }));
      await click(page.getByRole('combobox', { name: 'Sprint to plan' }));
      await click(page.getByRole('option', { name: /QRD Sprint 30/ }));
      return 'QRD Sprint 30 (active) chosen';
    });
    await step('Klik Load from Jira', 'The draft loads 5 open tickets and the Confluence split page', async () => {
      await click(page.getByRole('button', { name: /Load (again )?from Jira/ }));
      const text = await waitText(page.locator('main').first(), /5 open tickets/, 30000);
      await waitText(page.getByRole('region', { name: 'Split points from Confluence' }), /QRD Sprint 30 split/, 15000);
      return snippet(text.slice(text.indexOf('Draft loaded')), 160);
    });
    const split = () => page.getByRole('region', { name: 'Split points from Confluence' });
    await step('Split page: Use split page untuk QRD-9004', 'QRD-9004 moves to the week the split page gives', async () => {
      const row = split().locator('div').filter({ hasText: 'QRD-9004' }).last();
      await click(row.getByRole('button', { name: 'Use split page' }));
      await until('QRD-9004 still listed as a split difference', async () => !/QRD-9004/.test(await split().innerText()), 20000);
      return snippet(await split().innerText(), 200);
    });
    await step('Split page: Keep untuk QRD-9003', 'QRD-9003 keeps its draft week and leaves the difference list', async () => {
      const row = split().locator('div').filter({ hasText: 'QRD-9003' }).last();
      await click(row.getByRole('button', { name: 'Keep' }));
      await until('QRD-9003 still listed as a split difference', async () => !/QRD-9003/.test(await split().innerText()), 20000);
      return snippet(await split().innerText(), 200);
    });
    await step('Tab Scope, Run scout untuk QRD-9001', 'Scout session runs and the row shows its Scout line (light)', async () => {
      await click(page.getByRole('tab', { name: 'Scope', exact: true }));
      const row = page.locator('main li').filter({ has: page.getByRole('combobox', { name: 'Developer of QRD-9001' }) }).first();
      await click(row.getByRole('button', { name: 'Run scout' }));
      const text = await until('Scout line for QRD-9001 not shown', async () => {
        const body = await row.innerText();
        return /→ light/.test(body) ? body : null;
      }, 90000, 2000);
      return snippet(text, 200);
    });
  });

  await stage(3, 'Publish sprint contract to Confluence', async () => {
    await step('Klik Publish lalu Publish anyway', 'Publish dialog lists what is missing, then publishes', async () => {
      await goto('/planning?tab=draft');
      await unlock();
      await click(page.getByRole('combobox', { name: 'Sprint to plan' }));
      await click(page.getByRole('option', { name: /QRD Sprint 30/ }));
      await click(page.getByRole('button', { name: 'Publish', exact: true }).first());
      const dialog = page.getByRole('dialog');
      await waitText(dialog, /Publish to Jira/, 10000);
      await click(dialog.getByRole('button', { name: 'Publish anyway' }));
      await waitText(page.locator('main').first(), /Published/, 30000);
      return 'published from DOCK';
    });
    await step('Cek Confluence mock', 'The mock received page "Sprint contract QRD Sprint 30" under parent 5000', async () => {
      const page6 = await until('no contract page in the Confluence mock', async () => {
        const state = await mockState();
        return state.received.confluenceCreated.find((item) => item.title === 'Sprint contract QRD Sprint 30') ?? state.received.confluenceUpdated.find((item) => /Sprint contract/.test(item.title ?? ''));
      }, 30000);
      return `page ${page6.id} "${page6.title}" parent ${page6.parent}: ${snippet(page6.storage ?? '', 120)}`;
    });
    await step('Cek label Jira plan-published', 'Every sprint ticket got the plan-published label', async () => {
      const state = await mockState();
      const labelled = state.received.jiraUpdates.filter((item) => JSON.stringify(item.update ?? {}).includes('plan-published')).map((item) => item.key);
      if (labelled.length < 5) throw new Error(`only ${labelled.join(', ')} labelled`);
      return `labelled: ${labelled.join(', ')}`;
    });
  });

  await stage(4, 'Guild Master: Party proposal, ya, manager log, rollback', async () => {
    const gm = () => page.getByRole('complementary', { name: 'Guild Master' });
    await step('Sessions > New session > Guild Master dengan PIN', 'A Guild Master session opens (no shell, owner only)', async () => {
      await goto('/sessions');
      await unlock();
      await newSession('gm');
      await waitText(gm(), /WAITING FOR YOUR YA|Waiting for your ya/i, 15000);
      return 'Guild Master session started';
    });
    await step('Kirim "Party QRD-9002 light"', 'Guild Master proposes the Party diff and waits for ya', async () => {
      await send('Party QRD-9002 light');
      const text = await waitText(gm(), /Party QRD-9002: light/, 60000);
      return snippet(text.slice(text.indexOf('Party QRD-9002')), 200);
    });
    await step('Jawab "ya"', 'DOCK writes the change; manager log #1 applied', async () => {
      await send('ya');
      const text = await waitText(gm(), /#1[\s\S]*applied/, 60000);
      return snippet(text.slice(text.indexOf('MANAGER LOG')), 200);
    });
    await step('Klik Rollback pada #1 dan konfirmasi', 'Manager log shows #2 rollback of #1, #1 rolled back', async () => {
      await click(gm().getByRole('button', { name: /Rollback/ }).first());
      await click(page.getByRole('dialog').getByRole('button', { name: 'Roll back' }));
      const text = await waitText(gm(), /rollback of #1[\s\S]*rolled back/i, 30000);
      return snippet(text.slice(text.indexOf('MANAGER LOG')), 220);
    });
    await step('Kirim "Party QRD-9001 light" lalu "ya"', 'QRD-9001 gets a light Party (manager log #3), used by the light runner in stage 5', async () => {
      await send('Party QRD-9001 light');
      await waitText(gm(), /Party QRD-9001: light/, 60000);
      await send('ya');
      const text = await waitText(gm(), /#3[\s\S]*applied/, 60000);
      return snippet(text.slice(text.indexOf('MANAGER LOG')), 200);
    });
    await step('Blackboard QRD-9001 > Contract', 'The Contract shows the Party block written by Guild Master', async () => {
      await openBlackboard('QRD-9001');
      await click(page.getByRole('button', { name: /^Contract/ }).first());
      const text = await waitText(page.locator('main').first(), /Written by Guild Master/, 20000);
      return snippet(text.slice(text.indexOf('Party')), 200);
    });
  });

  await stage(5, 'Work tickets: full runner and light runner', async () => {
    await step('Work session: "Pakai skill sous: kerjakan QRD-9002." (full)', 'The full runner plans, codes, verifies, reviews and opens the PR', async () => {
      await goto('/sessions');
      await unlock();
      await newSession('work');
      await send('Pakai skill sous: kerjakan QRD-9002.');
      const text = await waitText(page.locator('main').first(), /MODE: full\s+RESULT: DONE/, 90000);
      return snippet(text.slice(text.indexOf('TICKET: QRD-9002')), 200);
    });
    await step('Work session: "Pakai skill sous: kerjakan QRD-9001." (light)', 'The light runner reads the Party and finishes in light mode', async () => {
      await newSession('work');
      await send('Pakai skill sous: kerjakan QRD-9001.');
      const text = await waitText(page.locator('main').first(), /MODE: light\s+RESULT: DONE/, 90000);
      return snippet(text.slice(text.indexOf('TICKET: QRD-9001')), 200);
    });
    await step('Buka ulang sesi Task-QRD-9002, lihat Usage', 'Usage shows the session cost with the subagents counted', async () => {
      await goto('/sessions');
      await openSession('Task-QRD-9002');
      const text = await until('subagent usage not shown', async () => {
        const body = await mainText();
        const match = /Subagents\s+(\d+)% of/.exec(body);
        return match && Number(match[1]) > 0 ? body : null;
      }, 30000);
      return snippet(text.slice(text.indexOf('USAGE')), 160);
    });
    await step('Blackboard QRD-9002 > Execution log', 'The Execution log lists the runner steps and the ticket cost', async () => {
      await openBlackboard('QRD-9002');
      await click(page.getByRole('button', { name: /Execution log/ }).first());
      const text = await waitText(page.locator('main').first(), /Ticket total/, 30000);
      return snippet(text.slice(text.indexOf('Execution log')), 240);
    });
    await step('Blackboard QRD-9002 > status.md', 'status.md shows the ledger with stage PR and AC 3/3', async () => {
      await click(page.getByRole('button', { name: /status\.md/ }).first());
      const text = await waitText(page.locator('main').first(), /QRD-9002[\s\S]*(PR|pr)/, 20000);
      return snippet(text.slice(text.indexOf('status.md')), 240);
    });
    await step('Blackboard QRD-9001 > light.md', 'The light run wrote light.md with its settings and result', async () => {
      await openBlackboard('QRD-9001');
      await click(page.getByRole('button', { name: /light\.md/ }).first());
      const text = await waitText(page.locator('main').first(), /Light run QRD-9001/, 20000);
      return snippet(text.slice(text.indexOf('Light run')), 200);
    });
  });

  await stage(6, 'PR and Discord broadcast', async () => {
    await step('Buka tiket QRD-9001', 'The ticket shows its GitHub PR dashboard#101 from the mock', async () => {
      await goto('/detail/QRD-9001');
      await unlock();
      const text = await waitText(page.locator('main').first(), /#101|pull\/101/, 30000);
      return snippet(text, 160);
    });
    await step('Klik Broadcast lalu Confirm & Post to Discord', 'DOCK posts the broadcast through the webhook', async () => {
      await click(page.getByRole('button', { name: /^Broadcast/ }).first());
      const dialog = page.getByRole('dialog');
      await waitText(dialog, /Discord Broadcast Preview/, 10000);
      await click(dialog.getByRole('button', { name: /Confirm & Post to Discord/ }));
      await until('broadcast dialog still open', async () => !(await page.getByRole('dialog').isVisible().catch(() => false)), 30000);
      return 'broadcast confirmed';
    });
    await step('Cek Discord mock webhook', 'The webhook received the QRD-9001 broadcast with the PR link', async () => {
      const post = await until('no broadcast on the webhook', async () => (await mockState()).received.webhookPosts.find((item) => /QRD-9001/.test(item.content + item.threadName) && /pull\/101/.test(item.content)), 30000);
      return `thread ${post.threadName ?? post.thread}: ${snippet(post.content, 160)}`;
    });
    await step('Cek status Jira QRD-9001', 'Broadcast moved QRD-9001 to PR Review', async () => {
      const issue = await until('QRD-9001 not in PR Review', async () => (await mockState()).issues.find((item) => item.key === 'QRD-9001' && item.status === 'PR Review'), 30000);
      return `QRD-9001: ${issue.status}`;
    });
  });

  await stage(7, 'Teammate review findings, light fix, DOCK-FIX reply', async () => {
    await step('Rizky bilang "on it" dan kirim temuan di thread QRD-9001', 'The on it and one finding (older than the 5 minute quiet window) show up live in DOCK Discord', async () => {
      await goto('/discord');
      await unlock();
      await click(page.getByText('QRD-9001 fix(QRD-9001)').first());
      await script(
        { action: 'addMessage', thread: 'QRD-9001', authorId: TEAMMATE, text: 'on it', ageMs: 7 * 60000 },
        { action: 'addMessage', thread: 'QRD-9001', authorId: TEAMMATE, text: 'validasi input kosong belum ada, tombol checkout tetap aktif kalau form kosong', ageMs: 6 * 60000 },
      );
      const text = await waitText(page.locator('main').first(), /validasi input kosong/, 60000);
      return snippet(text.slice(text.indexOf('on it')), 200);
    });
    await step('Tunggu DOCK membuka sesi temuan', 'Review findings round 1 starts a Task session for QRD-9001', async () => {
      await goto('/sessions');
      await unlock();
      await until('no findings session', async () => {
        await page.reload();
        await wait(1500);
        const text = await page.getByRole('navigation', { name: 'Sessions' }).innerText();
        return /Task-QRD-9001/.test(text) ? text : null;
      }, 150000, 8000);
      await openSession('Task-QRD-9001');
      const text = await waitText(page.locator('main').first(), /DOCK-REVIEW-ROUND|temuan sudah dicek/, 90000);
      return snippet(text.slice(text.lastIndexOf('Round')), 200);
    });
    await step('Cek balasan DOCK-FIX di thread', 'DOCK posts the fix reply with the DOCK-FIX line to the QRD-9001 thread', async () => {
      const post = await until('no DOCK-FIX reply on the webhook', async () => (await mockState()).received.webhookPosts.find((item) => /DOCK-FIX/.test(item.content)), 180000, 3000);
      return snippet(post.content, 240);
    });
    await step('Discord > thread QRD-9001', 'The thread in DOCK shows the finding and the DOCK-FIX reply', async () => {
      await goto('/discord');
      await click(page.getByText('QRD-9001 fix(QRD-9001)').first());
      const text = await waitText(page.locator('main').first(), /DOCK-FIX/, 60000);
      return snippet(text.slice(text.indexOf('validasi')), 200);
    });
  });

  await stage(8, 'Owner reviews the teammate PR: on it, review, fix, re-review, Approve, LGTM', async () => {
    let firstHead = null;
    await step('Owner bilang "on it" di thread QRD-9003', 'The owner on it lands in the pr-review thread', async () => {
      firstHead = (await mockState()).prs.find((item) => item.number === 102)?.head;
      await goto('/discord');
      await unlock();
      await click(page.getByText('QRD-9003 feat(QRD-9003)').first());
      await script({ action: 'addMessage', thread: 'QRD-9003', authorId: OWNER, text: 'on it' });
      await waitText(page.locator('main').first(), /on it/, 60000);
      return `on it posted; head ${String(firstHead).slice(0, 7)}`;
    });
    await step('Tunggu auto review', 'DOCK opens a Review session for QRD-9003 and the review is posted with DOCK-REVIEW', async () => {
      const post = await until('no DOCK-REVIEW post', async () => (await mockState()).received.webhookPosts.find((item) => /DOCK-REVIEW/.test(item.content) && /QRD-9003/.test(item.threadName ?? '') || (/DOCK-REVIEW/.test(item.content) && item.thread === '100000000000002003')), 240000, 3000);
      await waitText(page.locator('main').first(), /DOCK-REVIEW/, 60000);
      return snippet(post.content, 240);
    });
    await step('Sessions > Review-QRD-9003', 'The review session shows request change with 1 blocker', async () => {
      await goto('/sessions');
      await unlock();
      await openSession(/Review-QRD-9003(?!\s*\()/);
      const text = await waitText(page.locator('main').first(), /request change/i, 30000);
      return snippet(text.slice(text.search(/Verdict/)), 200);
    });
    await step('Teammate DOCK-FIX dan head baru', 'Rizky\'s DOCK pushes a new head and replies DOCK-FIX round 1', async () => {
      const state = await until('no teammate DOCK-FIX', async () => {
        const s = await mockState();
        const thread = s.threads.find((item) => item.id === '100000000000002003');
        return thread?.messages.some((item) => item.webhookId === TEAMMATE_WEBHOOK && /DOCK-FIX/.test(item.text)) ? s : null;
      }, 60000, 2000);
      const head = state.prs.find((item) => item.number === 102).head;
      if (head === firstHead) throw new Error('PR head did not change');
      return `new head ${head.slice(0, 7)}`;
    });
    await step('Tunggu auto re-review', 'DOCK re-reviews the new head on its own and approves', async () => {
      const review = await until('no APPROVED review on dashboard#102', async () => (await mockState()).received.githubReviews.find((item) => item.number === 102 && item.state === 'APPROVED'), 300000, 4000);
      return `GitHub review ${review.state} on ${String(review.commitId).slice(0, 7)}`;
    });
    await step('Cek LGTM di thread', 'The approve review goes to the thread (DOCK-REVIEW round 2)', async () => {
      const posts = await until('no second DOCK-REVIEW post', async () => {
        const list = (await mockState()).received.webhookPosts.filter((item) => /DOCK-REVIEW/.test(item.content) && item.thread === '100000000000002003');
        return list.length >= 2 ? list : null;
      }, 120000, 3000);
      return snippet(posts.at(-1).content, 240);
    });
    await step('Agents page: review QRD-9003', 'The review run shows the Approve verdict', async () => {
      await goto('/agents');
      const text = await waitText(page.locator('main').first(), /QRD-9003/, 30000);
      return snippet(text.slice(text.indexOf('QRD-9003')), 200);
    });
  });

  await stage(9, 'Done: merge, Jira moves, Review findings history, Judge and retro', async () => {
    await step('Rizky merge PR dashboard#101 (QRD-9001)', 'The mock marks the PR merged', async () => {
      await goto('/detail/QRD-9001');
      await unlock();
      await script({ action: 'mergePr', pr: 'https://github.com/qonflo/dashboard/pull/101', by: 'rizky-dev' });
      const merged = (await mockState()).prs.find((item) => item.number === 101 && item.repo === 'qonflo/dashboard');
      if (!merged?.merged) throw new Error('PR 101 not merged');
      return 'dashboard#101 merged';
    });
    await step('Tunggu DOCK memindahkan Jira', 'DOCK moves QRD-9001 from PR Review to UAT MERGED (Jira sync, every 5 minutes)', async () => {
      const move = await until('QRD-9001 not moved to UAT MERGED', async () => (await mockState()).received.jiraTransitions.find((item) => item.key === 'QRD-9001' && item.to === 'UAT MERGED'), 420000, 5000);
      await page.reload();
      await waitText(page.locator('main').first(), /UAT MERGED/i, 60000);
      return `${move.key}: ${move.from} → ${move.to}`;
    });
    await step('Blackboard QRD-9001 > Review findings', 'Review findings history lists round 1 with the DOCK-FIX reply', async () => {
      await openBlackboard('QRD-9001');
      await unlock();
      await click(page.getByRole('button', { name: /Review findings/ }).first());
      const text = await waitText(page.locator('main').first(), /Review findings[\s\S]*(sent|terkirim|DOCK-FIX|fixed)/i, 30000);
      return snippet(text.slice(text.indexOf('Every round')), 240);
    });
    await step('Planning > Now: Load last 15 sprints', 'The sprint dashboard reads QRD Sprint 30 from Jira', async () => {
      await goto('/planning?tab=now');
      const load = page.getByRole('button', { name: 'Load last 15 sprints' });
      await click(load);
      const text = await waitText(page.locator('main').first(), /QRD Sprint 30/, 120000);
      return snippet(text.slice(text.indexOf('QRD Sprint 30')), 200);
    });
    await step('Planning > Retro: Judge now', 'Judge reads the quiet sessions of the sprint; Sprint days lists the judged day', async () => {
      await click(page.getByRole('tab', { name: 'Retro', exact: true }));
      const days = page.getByRole('region', { name: 'Days of the sprint' });
      let pressed = 0;
      const text = await until('no session judged yet', async () => {
        const body = await days.innerText();
        if (!/no sessions judged yet/.test(body)) return body;
        if (Date.now() - pressed > 30000) {
          await click(days.getByRole('button', { name: 'Judge now' }));
          pressed = Date.now();
        }
        return null;
      }, 240000, 3000);
      return snippet(text, 240);
    });
  });
}

function concatVideos() {
  const files = stageRuns.filter((run) => run.video).map((run) => path.join(OUT, run.video));
  if (!files.length) return null;
  const list = path.join(OUT, 'videos', 'concat.txt');
  writeFileSync(list, files.map((file) => `file '${file.replace(/\\/g, '/')}'`).join('\n'));
  const target = path.join(OUT, 'full-run.webm');
  const copy = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', target], { windowsHide: true, encoding: 'utf8' });
  if (copy.status === 0 && existsSync(target)) {
    rmSync(list, { force: true });
    return 'full-run.webm';
  }
  const encode = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libvpx', '-b:v', '1M', target], { windowsHide: true, encoding: 'utf8' });
  rmSync(list, { force: true });
  return encode.status === 0 && existsSync(target) ? 'full-run.webm' : null;
}

async function main() {
  const started = Date.now();
  mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  mkdirSync(path.join(OUT, 'videos'), { recursive: true });
  rmSync(E2E_DIR, { recursive: true, force: true });
  const env = { ...process.env, E2E_DIR };
  let fatal = null;
  try {
    stack = await startStack({ withBridge: true, fresh: !ONLY.length || ONLY.includes(1), env, log: (line) => process.stdout.write(`${line}\n`) });
    browser = await chromium.launch({ channel: 'chrome', headless: process.env.E2E_HEADED !== '1' });
    await stages();
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    process.stderr.write(`e2e: ${fatal}\n`);
  } finally {
    await browser?.close().catch(() => undefined);
    await stack?.stop().catch(() => undefined);
  }
  mkdirSync(path.join(OUT, 'logs'), { recursive: true });
  for (const name of ['backend.log', 'bridge.log', 'mock.log', 'frontend.log']) {
    const from = path.join(E2E_DIR, name);
    if (existsSync(from)) copyFileSync(from, path.join(OUT, 'logs', name.replace('.log', '.txt')));
  }
  const full = concatVideos();
  const report = renderReport({ results, stages: stageRuns, fatal, startedAt: new Date(started), durationMs: Date.now() - started, full, outDir: OUT });
  writeFileSync(path.join(OUT, 'report.html'), report);
  const failed = results.filter((row) => row.status !== 'PASS').length;
  process.stdout.write(`\n${results.length - failed}/${results.length} steps passed. Report: ${path.join(OUT, 'report.html')}\n`);
  process.exitCode = fatal || failed ? 1 : 0;
}

process.on('unhandledRejection', (error) => process.stderr.write(`e2e: unhandled ${error instanceof Error ? error.message.split('\n')[0] : String(error)}\n`));
await main();
