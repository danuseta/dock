import assert from 'node:assert';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttachmentTray } from '../chat/composer/AttachmentTray';
import type { AttachmentItem } from '../chat/composer/useAttachments';
import { UPLOAD_CONCURRENCY, UploadRefused, createUploadQueue, retryOnce } from '../chat/composer/uploadQueue';

const settle = () => new Promise((resolve) => setImmediate(resolve));

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
};

test('at most two uploads run at once and the rest start in the order they were picked', async () => {
  assert.strictEqual(UPLOAD_CONCURRENCY, 2);
  const enqueue = createUploadQueue();
  const started: number[] = [];
  let running = 0;
  let peak = 0;
  const gates = [0, 1, 2, 3, 4].map(() => gate());
  const done = gates.map((one, index) => enqueue(async () => {
    started.push(index);
    running += 1;
    peak = Math.max(peak, running);
    await one.opened;
    running -= 1;
    return index;
  }));
  await settle();
  assert.deepStrictEqual(started, [0, 1]);
  gates[0].open();
  await settle();
  assert.deepStrictEqual(started, [0, 1, 2]);
  gates[2].open();
  gates[1].open();
  await settle();
  assert.deepStrictEqual(started, [0, 1, 2, 3, 4]);
  gates[3].open();
  gates[4].open();
  assert.deepStrictEqual(await Promise.all(done), [0, 1, 2, 3, 4]);
  assert.strictEqual(peak, 2);
});

test('a failed upload frees its slot for the next one', async () => {
  const enqueue = createUploadQueue(1);
  const first = enqueue(async () => { throw new Error('boom'); });
  const second = enqueue(async () => 'ok');
  await assert.rejects(first, /boom/);
  assert.strictEqual(await second, 'ok');
});

test('a busy answer is retried once, other errors and a second busy answer are not', async () => {
  const busy = (error: unknown) => error instanceof UploadRefused && error.status === 429;
  const signal = new AbortController().signal;
  const pauses: number[] = [];
  const pause = async (ms: number) => { pauses.push(ms); };
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new UploadRefused(429, 'Too many uploads at once');
    return 'uploaded';
  };
  assert.strictEqual(await retryOnce(flaky, busy, pause, signal, 10), 'uploaded');
  assert.deepStrictEqual([calls, pauses], [2, [10]]);

  calls = 0;
  await assert.rejects(retryOnce(async () => { calls += 1; throw new UploadRefused(409, 'Too many files are waiting'); }, busy, pause, signal, 10), /waiting/);
  assert.strictEqual(calls, 1);

  calls = 0;
  await assert.rejects(retryOnce(async () => { calls += 1; throw new UploadRefused(429, 'again'); }, busy, pause, signal, 10), /again/);
  assert.strictEqual(calls, 2, 'one retry, not a loop');

  const controller = new AbortController();
  calls = 0;
  await assert.rejects(
    retryOnce(async () => { calls += 1; throw new UploadRefused(429, 'busy'); }, busy, async () => controller.abort(), controller.signal, 10),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.strictEqual(calls, 1, 'a file removed while it waits is not sent again');
});

test('the remove buttons are disabled while a message is being sent', () => {
  const item: AttachmentItem = { key: 'k1', name: 'shot.png', mime: 'image/png', size: 10, state: 'ready', progress: 1, id: 'a', error: null, previewUrl: null };
  const live = renderToStaticMarkup(<AttachmentTray items={[item]} notice="" onRemove={() => undefined} />);
  const locked = renderToStaticMarkup(<AttachmentTray items={[item]} notice="" disabled onRemove={() => undefined} />);
  assert.doesNotMatch(live, /<button[^>]* disabled=""/);
  assert.match(locked, /<button[^>]*aria-label="Remove shot.png"[^>]* disabled=""/);
});
