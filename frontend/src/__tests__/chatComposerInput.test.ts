import assert from 'node:assert';
import test from 'node:test';
import { readDraft, writeDraft } from '../chat/composer/composerInput';

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
};

const withStorage = (storage: unknown, run: () => void) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { localStorage: storage }, configurable: true, writable: true });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete (globalThis as { window?: unknown }).window;
  }
};

test('a draft survives a remount and is cleared when it becomes empty', () => {
  const storage = memory();
  withStorage(storage, () => {
    assert.strictEqual(readDraft('s1'), '');
    writeDraft('s1', 'half typed');
    assert.strictEqual(storage.data.get('dock-chat-draft:s1'), 'half typed');
    assert.strictEqual(readDraft('s1'), 'half typed');
    assert.strictEqual(readDraft('s2'), '');
    writeDraft('s1', '');
    assert.strictEqual(storage.data.has('dock-chat-draft:s1'), false);
  });
});

test('a storage that throws never breaks the draft', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  withStorage(broken, () => {
    assert.strictEqual(readDraft('s1'), '');
    writeDraft('s1', 'text');
    writeDraft('s1', '');
  });
});
