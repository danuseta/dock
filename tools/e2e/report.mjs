const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const seconds = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

export function renderReport({ results, stages, fatal, startedAt, durationMs, full }) {
  const count = (status, rows = results) => rows.filter((row) => row.status === status).length;
  const stageStatus = (rows) => (rows.length === 0 ? 'SKIP' : rows.some((row) => row.status === 'FAIL') ? 'FAIL' : rows.every((row) => row.status === 'PASS') ? 'PASS' : 'SKIP');
  const summary = stages.map((stage) => ({ ...stage, rows: results.filter((row) => row.stage === stage.n) }));
  const passedStages = summary.filter((stage) => stageStatus(stage.rows) === 'PASS').length;
  const sections = summary.map((stage) => {
    const status = stageStatus(stage.rows);
    const rows = stage.rows.map((row) => `
        <tr class="${row.status.toLowerCase()}">
          <td class="num">${stage.n}.${row.n}</td>
          <td>${escape(row.action)}</td>
          <td>${escape(row.expected)}</td>
          <td>${escape(row.actual)}${row.status === 'FAIL' && row.error ? `<pre>${escape(row.error)}</pre>` : ''}</td>
          <td><span class="badge ${row.status.toLowerCase()}">${row.status}</span><div class="ms">${seconds(row.ms)}</div></td>
          <td>${row.screenshot ? `<a href="${escape(row.screenshot)}" target="_blank" rel="noopener"><img src="${escape(row.screenshot)}" alt="Screenshot ${stage.n}.${row.n}" loading="lazy"></a>` : '-'}</td>
        </tr>`).join('');
    return `
    <details class="stage ${status.toLowerCase()}"${status === 'FAIL' ? ' open' : ''}>
      <summary><span class="badge ${status.toLowerCase()}">${status}</span><b>Stage ${stage.n}</b> ${escape(stage.title)}<span class="meta">${count('PASS', stage.rows)}/${stage.rows.length} steps · ${seconds(stage.ms)}</span></summary>
      ${stage.video ? `<video controls preload="metadata" src="${escape(stage.video)}"></video>` : '<p class="meta">No video recorded.</p>'}
      <table>
        <thead><tr><th>#</th><th>Action</th><th>Expected</th><th>Actual</th><th>Result</th><th>Screenshot</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DOCK e2e report</title>
<style>
  :root { color-scheme: dark; --bg: #0d0f12; --panel: #161a20; --line: #2a303a; --text: #e8eaee; --muted: #9aa3af; --pass: #3ecf8e; --fail: #ff5d5d; --skip: #9aa3af; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { margin: 0 0 4px; font-size: 24px; }
  .meta { color: var(--muted); font-size: 12px; margin-left: auto; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0 24px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
  .card b { display: block; font-size: 22px; }
  .card span { color: var(--muted); font-size: 12px; }
  .fatal { border: 1px solid var(--fail); color: var(--fail); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; white-space: pre-wrap; }
  details.stage { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; margin-bottom: 12px; }
  details.stage.fail { border-color: color-mix(in srgb, var(--fail) 60%, var(--line)); }
  summary { display: flex; align-items: center; gap: 10px; padding: 12px 14px; cursor: pointer; flex-wrap: wrap; }
  video { display: block; width: calc(100% - 28px); margin: 0 14px 12px; border-radius: 6px; background: #000; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border-top: 1px solid var(--line); padding: 8px 10px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; }
  th:nth-child(1) { width: 52px; } th:nth-child(5) { width: 84px; } th:nth-child(6) { width: 180px; }
  td img { width: 160px; border-radius: 4px; border: 1px solid var(--line); display: block; }
  tr.fail td { background: color-mix(in srgb, var(--fail) 8%, transparent); }
  pre { white-space: pre-wrap; color: var(--fail); font-size: 12px; margin: 6px 0 0; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: .04em; border: 1px solid currentColor; }
  .badge.pass { color: var(--pass); } .badge.fail { color: var(--fail); } .badge.skip { color: var(--skip); }
  .ms { color: var(--muted); font-size: 11px; margin-top: 4px; }
  .num { color: var(--muted); font-variant-numeric: tabular-nums; }
  ol.videos { color: var(--muted); }
  a { color: #8ab4ff; }
  @media (max-width: 760px) { th:nth-child(3), td:nth-child(3) { display: none; } th:nth-child(6) { width: 96px; } td img { width: 88px; } }
</style>
</head>
<body>
<main>
  <h1>DOCK e2e with mocks</h1>
  <div class="meta">Started ${escape(startedAt.toLocaleString())} · dark mode · 1440×900 · mock Jira, Confluence, GitHub, Discord and a fake chat bridge</div>
  <div class="cards">
    <div class="card"><b>${passedStages}/${stages.length}</b><span>stages passed</span></div>
    <div class="card"><b style="color:var(--pass)">${count('PASS')}</b><span>steps PASS</span></div>
    <div class="card"><b style="color:var(--fail)">${count('FAIL')}</b><span>steps FAIL</span></div>
    <div class="card"><b>${count('SKIP')}</b><span>steps not run</span></div>
    <div class="card"><b>${seconds(durationMs)}</b><span>duration</span></div>
  </div>
  ${fatal ? `<div class="fatal">${escape(fatal)}</div>` : ''}
  ${full ? `<details class="stage"><summary><b>Full run</b><span class="meta">all stages in order</span></summary><video controls preload="metadata" src="${escape(full)}"></video></details>` : `<p class="meta">Stage videos in order:</p><ol class="videos">${stages.filter((stage) => stage.video).map((stage) => `<li><a href="${escape(stage.video)}">${escape(stage.video)}</a></li>`).join('')}</ol>`}
  ${sections}
  <p class="meta">Logs: <a href="logs/backend.txt">backend</a> · <a href="logs/bridge.txt">bridge</a> · <a href="logs/mock.txt">mock</a> · <a href="logs/frontend.txt">frontend</a></p>
</main>
</body>
</html>
`;
}
