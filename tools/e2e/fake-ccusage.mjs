#!/usr/bin/env node
const args = process.argv.slice(2);
const [tool, command] = args;
const flag = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const MODELS = [
  { modelName: 'claude-opus-4-1', inputTokens: 42000, outputTokens: 18000, cacheCreationTokens: 120000, cacheReadTokens: 2400000, cost: 6.4 },
  { modelName: 'claude-sonnet-4-5', inputTokens: 30000, outputTokens: 12000, cacheCreationTokens: 80000, cacheReadTokens: 1300000, cost: 1.9 },
];
const totals = (rows) => rows.reduce((sum, row) => ({
  inputTokens: sum.inputTokens + row.inputTokens,
  outputTokens: sum.outputTokens + row.outputTokens,
  cacheCreationTokens: sum.cacheCreationTokens + row.cacheCreationTokens,
  cacheReadTokens: sum.cacheReadTokens + row.cacheReadTokens,
  totalCost: sum.totalCost + row.cost,
}), { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 });

if (tool !== 'claude' || !['daily', 'session'].includes(command) || !args.includes('--json')) {
  process.stderr.write('fake-ccusage: claude daily --json | claude session --json --id <id>\n');
  process.exit(1);
}
if (command === 'daily') {
  const daily = [-2, -1, 0].map((offset) => {
    const sum = totals(MODELS);
    return { date: day(offset), ...sum, totalTokens: sum.inputTokens + sum.outputTokens + sum.cacheCreationTokens + sum.cacheReadTokens, modelsUsed: MODELS.map((row) => row.modelName), modelBreakdowns: MODELS };
  });
  process.stdout.write(JSON.stringify({ daily }));
} else {
  const id = flag('--id') ?? 'session';
  const now = Date.now();
  const entries = [
    { timestamp: new Date(now - 3600000).toISOString(), model: 'claude-opus-4-1', inputTokens: 21000, outputTokens: 9000, cacheCreationTokens: 60000, cacheReadTokens: 1200000, costUSD: 3.2 },
    { timestamp: new Date(now - 1800000).toISOString(), model: 'claude-sonnet-4-5', inputTokens: 15000, outputTokens: 6000, cacheCreationTokens: 40000, cacheReadTokens: 650000, costUSD: 0.95 },
  ];
  const sum = entries.reduce((total, entry) => total + entry.inputTokens + entry.outputTokens + entry.cacheCreationTokens + entry.cacheReadTokens, 0);
  process.stdout.write(JSON.stringify({ sessionId: id, totalCost: 4.15, totalTokens: sum, entries }));
}
