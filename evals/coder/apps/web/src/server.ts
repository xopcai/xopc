import { createServer, type ServerResponse } from 'node:http';
import { parseArgs } from 'node:util';

import { EvalStore } from '@agent-evals/storage';

const { values } = parseArgs({
  options: {
    db: { type: 'string', default: '.xopc-evals/evals.db' },
    port: { type: 'string', default: '4310' },
    host: { type: 'string', default: '127.0.0.1' },
  },
});
const store = new EvalStore(values.db!);

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Evals</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f5f7fa; color: #18212f; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f5f7fa; }
    header { height: 58px; display: flex; align-items: center; justify-content: space-between; padding: 0 28px; color: #f8fafc; background: #18212f; border-bottom: 3px solid #1b8f6a; }
    header strong { font-size: 16px; } header span { color: #b8c2d0; font-size: 12px; }
    main { width: min(1180px, calc(100% - 32px)); margin: 26px auto; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 22px; }
    .metric { border: 1px solid #d9dee7; background: #fff; padding: 15px; border-radius: 6px; }
    .metric b { display: block; font-size: 24px; margin-top: 4px; } .metric small { color: #687386; }
    h1 { font-size: 20px; margin: 0 0 14px; } table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d9dee7; }
    th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid #e5e9ef; font-size: 13px; }
    th { color: #596579; background: #f8fafc; font-weight: 600; } tr[data-id], tr[data-run-id] { cursor: pointer; } tr[data-id]:hover, tr[data-run-id]:hover { background: #f1f7f5; }
    .status { font-weight: 600; } .completed, .passed { color: #087655; } .failed, .error, .timed_out, .budget_exceeded { color: #b42318; }
    #detail { margin-top: 24px; } .empty { padding: 30px; text-align: center; color: #687386; border: 1px dashed #bec7d4; }
    code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }
    @media (prefers-color-scheme: dark) { :root, body { background: #11161d; color: #e6eaf0; } .metric, table { background: #171e27; border-color: #303a47; } th { background: #1d2631; color: #aeb8c6; } th, td { border-color: #303a47; } tr[data-id]:hover, tr[data-run-id]:hover { background: #172a27; } .metric small { color: #9ca8b8; } }
    @media (max-width: 700px) { header { padding: 0 16px; } .summary { grid-template-columns: 1fr; } main { width: calc(100% - 20px); } th:nth-child(3), td:nth-child(3) { display: none; } }
  </style>
</head>
<body>
  <header><strong>Agent Evals</strong><span>Local evaluation control plane</span></header>
  <main><div id="app" class="empty">Loading experiments…</div><section id="detail"></section></main>
  <script>
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    async function load() {
      const experiments = await fetch('/api/experiments').then(r => r.json());
      const runs = experiments.reduce((sum, e) => sum + Number(e.run_count || 0), 0);
      const passed = experiments.reduce((sum, e) => sum + Number(e.passed_count || 0), 0);
      document.querySelector('#app').className = '';
      const trend = await fetch('/api/trends?limit=20').then(r => r.json());
      document.querySelector('#app').innerHTML = \
        '<div class="summary"><div class="metric"><small>Experiments</small><b>' + experiments.length + '</b></div>' +
        '<div class="metric"><small>Runs</small><b>' + runs + '</b></div>' +
        '<div class="metric"><small>Verified pass rate</small><b>' + (runs ? Math.round(passed / runs * 100) : 0) + '%</b></div></div>' +
        '<h1>Experiments</h1>' + (experiments.length ? '<table><thead><tr><th>Name</th><th>Status</th><th>Suite</th><th>Runs</th><th>Score</th></tr></thead><tbody>' +
        experiments.map(e => '<tr data-id="' + esc(e.id) + '"><td><strong>' + esc(e.name) + '</strong><br><code>' + esc(e.id) + '</code></td><td class="status ' + esc(e.status) + '">' + esc(e.status) + '</td><td>' + esc(e.suite_id) + '@' + esc(e.suite_version) + '</td><td>' + Number(e.passed_count || 0) + '/' + Number(e.run_count || 0) + '</td><td>' + Number(e.average_score || 0).toFixed(2) + '</td></tr>').join('') +
        '</tbody></table>' : '<div class="empty">No experiments yet. Run one from the CLI.</div>') +
        '<h1 style="margin-top:24px">Recent variant trend</h1>' +
        (trend.length ? '<table><thead><tr><th>Created</th><th>Suite</th><th>Variant</th><th>Pass</th><th>Failures</th><th>Score</th></tr></thead><tbody>' +
        trend.map(t => '<tr><td>' + esc(t.created_at) + '</td><td>' + esc(t.suite_id) + '@' + esc(t.suite_version) + '</td><td>' + esc(t.variant_id) + '</td><td>' + Number(t.passed_count || 0) + '/' + Number(t.run_count || 0) + '</td><td>' + Number(t.execution_failure_count || 0) + '</td><td>' + Number(t.average_score || 0).toFixed(2) + '</td></tr>').join('') +
        '</tbody></table>' : '<div class="empty">No trend data yet.</div>');
      document.querySelectorAll('tr[data-id]').forEach(row => row.addEventListener('click', () => show(row.dataset.id)));
    }
    async function show(id) {
      const detail = await fetch('/api/experiments/' + encodeURIComponent(id)).then(r => r.json());
      document.querySelector('#detail').innerHTML = '<h1>Runs</h1><table><thead><tr><th>Case</th><th>Variant</th><th>Status</th><th>Score</th><th>Duration</th></tr></thead><tbody>' + detail.runs.map(r => {
        const duration = r.ended_at ? ((new Date(r.ended_at) - new Date(r.started_at)) / 1000).toFixed(1) + 's' : '—';
        return '<tr data-run-id="' + esc(r.id) + '"><td>' + esc(r.case_id) + '</td><td>' + esc(r.variant_id) + '</td><td class="status ' + esc(r.status) + '">' + esc(r.status) + '</td><td>' + Number(r.score || 0).toFixed(2) + '</td><td>' + duration + '</td></tr>';
      }).join('') + '</tbody></table>';
      document.querySelectorAll('tr[data-run-id]').forEach(row => row.addEventListener('click', () => showRun(row.dataset.runId)));
    }
    async function showRun(id) {
      const detail = await fetch('/api/runs/' + encodeURIComponent(id)).then(r => r.json());
      const scores = detail.scores.map(s => '<tr><td>' + Number(s.grader_index) + '</td><td>' + esc(s.grader_type) + '</td><td class="status ' + (s.passed ? 'passed' : 'failed') + '">' + (s.passed ? 'passed' : 'failed') + '</td><td>' + esc(s.summary) + '</td></tr>').join('');
      const events = detail.events.map(e => '<tr><td>' + Number(e.seq) + '</td><td><code>' + esc(e.type) + '</code></td><td>' + esc(e.timestamp) + '</td><td><code>' + esc(e.payload_json).slice(0, 180) + '</code></td></tr>').join('');
      document.querySelector('#detail').innerHTML = '<h1>Run ' + esc(id) + '</h1>' +
        '<table><thead><tr><th>#</th><th>Grader</th><th>Result</th><th>Evidence</th></tr></thead><tbody>' + scores + '</tbody></table>' +
        '<h1 style="margin-top:24px">Trajectory</h1><table><thead><tr><th>Seq</th><th>Event</th><th>Time</th><th>Payload</th></tr></thead><tbody>' + events + '</tbody></table>';
    }
    load().catch(error => document.querySelector('#app').textContent = error.message);
  </script>
</body></html>`;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/experiments') {
    json(response, 200, store.listExperiments());
    return;
  }
  if (url.pathname === '/api/trends') {
    const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);
    const limit = Number.isInteger(rawLimit) ? rawLimit : 100;
    json(response, 200, store.listTrend({
      ...(url.searchParams.get('suiteId')
        ? { suiteId: url.searchParams.get('suiteId')! }
        : {}),
      limit,
    }));
    return;
  }
  const match = url.pathname.match(/^\/api\/experiments\/([^/]+)$/);
  if (match) {
    const detail = store.getExperiment(decodeURIComponent(match[1]!));
    json(response, detail ? 200 : 404, detail ?? { error: 'Experiment not found' });
    return;
  }
  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch) {
    const detail = store.getRun(decodeURIComponent(runMatch[1]!));
    json(response, detail ? 200 : 404, detail ?? { error: 'Run not found' });
    return;
  }
  if (url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  json(response, 404, { error: 'Not found' });
});

const port = Number.parseInt(values.port!, 10);
server.listen(port, values.host!, () => {
  console.log(`Agent Evals dashboard: http://${values.host}:${port}`);
});

const shutdown = () => server.close(() => {
  store.close();
  process.exit(0);
});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
