import assert from 'node:assert';
import test from 'node:test';

process.env.DATABASE_URL = 'file:./data/unit.db';

test('the database URL gets one connection and longer waits without losing what it already sets', async () => {
  const { withPoolParams } = await import('../storage/client');
  const added = 'connection_limit=1&pool_timeout=30&socket_timeout=10';
  assert.strictEqual(withPoolParams('file:./data/jidis.db'), `file:./data/jidis.db?${added}`);
  assert.strictEqual(withPoolParams('file:C:/x/jidis.db'), `file:C:/x/jidis.db?${added}`);
  assert.strictEqual(withPoolParams('file:/app/data/jidis.db'), `file:/app/data/jidis.db?${added}`);
  assert.strictEqual(withPoolParams('file:./a.db?connection_limit=5&x=a%20b'), 'file:./a.db?connection_limit=5&x=a%20b&pool_timeout=30&socket_timeout=10');
  assert.strictEqual(withPoolParams('postgresql://u@h/db?schema=public'), 'postgresql://u@h/db?schema=public');
});
