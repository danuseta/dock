import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const pngSize = (file: string) => { const png = fs.readFileSync(path.join(root, 'public', file)); return [png.readUInt32BE(16), png.readUInt32BE(20)]; };

test('the manifest opens DOCK as a standalone app and its icons exist at the sizes it names', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  assert.deepStrictEqual([manifest.display, manifest.start_url, manifest.scope], ['standalone', '/', '/']);
  for (const icon of manifest.icons) {
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.deepStrictEqual(pngSize(icon.src.slice(1)), [width, height], icon.src);
  }
  assert.deepStrictEqual(manifest.icons.map((icon: { sizes: string }) => icon.sizes), ['192x192', '512x512']);
});

test('the page links the manifest and carries the tags iOS needs to open it without the Safari bars', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const tag of [
    '<link rel="manifest" href="/manifest.webmanifest" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black" />',
  ]) assert.ok(html.includes(tag), tag);
  assert.deepStrictEqual(pngSize('apple-touch-icon.png'), [180, 180]);
});
