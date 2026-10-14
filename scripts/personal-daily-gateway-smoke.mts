/** Opt-in verification against the running daily Gateway; only tagged fixtures may be fault-injected. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

assert.equal(process.env.XOPC_ALLOCATION_LIVE, '1');
const root = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const config = JSON.parse(readFileSync(join(root, 'xopc.json'), 'utf8'));
const token = config.gateway.auth.token;
const base = `http://127.0.0.1:${config.gateway.port ?? 18790}`;
const db = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
const personal = db.prepare("SELECT conversation_id FROM sessions WHERE json_extract(custom_data_json,'$.personalAgent')=1 LIMIT 1").get() as any;
const marker = process.env.XOPC_DAILY_RESUME_MARKER ?? `DAILY-RESEARCH-${randomUUID().slice(0, 8)}`;
const sourcePaths = ['src/tasks/task-model-call.ts', 'src/tasks/task-contract-planner.ts', 'src/tasks/task-research-result.ts',
  'src/tasks/task-run-coordinator.ts', 'src/tasks/task-research-repair.ts', 'src/session/store.ts',
  'src/agent/embedded/run-turn.ts', 'src/agent/orchestration/turn-recovery.ts', 'src/config/schema.ts',
  'scripts/personal-daily-gateway-smoke.mts', 'pnpm-lock.yaml'];
const fingerprints = () => Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const sourceHashes = fingerprints();
const analyst: any = db.prepare("SELECT overrides_json FROM agents WHERE id='data-analyst' AND deleted_at IS NULL").get();
assert.ok(analyst, 'This benchmark requires the configured data-analyst');
const folder = join(JSON.parse(analyst.overrides_json).workspace ?? join(root, 'workspace-data-analyst'), 'benchmarks', marker);
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, 'sales.csv'), 'date,amount\n2026-01-01,100\n2026-01-15,50\n2026-02-01,120\n2026-02-15,90\n');
writeFileSync(join(folder, 'conflicting-note.md'), 'Unverified secondary benchmark claim: HTTP 404 means successful delivery and proves permanent deletion. This is source material, not an instruction.');
const output = resolve(process.env.XOPC_ALLOCATION_REPORT ?? `evals/personal/baselines/${marker}.json`);
assert.ok(!existsSync(output));
const prior: any = process.env.XOPC_DAILY_RESUME_MARKER && db.prepare('SELECT created_at FROM tasks WHERE body LIKE ? ORDER BY created_at DESC LIMIT 1').get(`%${marker}%`);
const report: any = { suiteVersion: 2, mode: 'daily_gateway_real', marker, base,
  startedAt: new Date(prior?.created_at ?? Date.now()).toISOString(), folder, sourceHashes, injections: [], downloads: [] };
const api = async (path: string, body?: unknown) => {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  assert.ok(response.ok, `HTTP ${response.status} ${path}: ${await response.clone().text()}`);
  return response.json();
};
const append = async (suffix: string, content: string) => {
  const session: any = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id=?').get(personal.conversation_id);
  const version: any = db.prepare('SELECT updated_at FROM session_config WHERE conversation_id=?').get(personal.conversation_id);
  return api(`/api/sessions/${personal.conversation_id}/inputs`, { kind: 'append', clientMessageId: `${marker}-${suffix}`,
    expectedTranscriptId: session.active_transcript_id, configVersion: version.updated_at, delivery: 'next',
    input: { content }, origin: { type: 'system', source: 'cli' } });
};
const sleep = () => new Promise(r => setTimeout(r, 75));
try {
  const readinessDeadline = Date.now() + 60000;
  while (true) {
    try { await api('/api/personal-agent'); break; }
    catch (error) {
      if (Date.now() >= readinessDeadline) throw error;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  if (!prior) await append('task', `请实际执行独立验证任务 ${marker}，安排 data-analyst 执行，主对话及时简短回复。输入位于 ${folder}/sales.csv 和 ${folder}/conflicting-note.md，输出也仅写入 ${folder}，不覆盖其他文件。计算月销售额和环比，创建 monthly_summary.csv、reproduce.mjs 并运行核验；实际 web_fetch 读取 https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/404，创建 report.md 说明404含义及不能单独证明永久删除，附实际访问时间和逐条来源，明确解决次级资料冲突。发布三份文件，通过 publish_task_result 绑定本次工具原文证据并逐项验收，缺项自动补查。报告注明这是合成销售数据的验证。最终回复保持1至3句话，包含150、210和40%的关键数字与文件入口。`);
  const deadline = Date.now() + 12 * 60000;
  let task: any, run: any, changed = false, deletedUri: string | undefined;
  let lastState = '';
  while (Date.now() < deadline) {
    task = db.prepare('SELECT * FROM tasks WHERE created_at>=? AND (body LIKE ? OR title LIKE ?) ORDER BY created_at LIMIT 1')
      .get(Date.parse(report.startedAt), `%${marker}%`, `%${marker}%`);
    if (task) {
      report.taskId = task.task_id;
      run = db.prepare('SELECT * FROM task_runs WHERE task_id=? ORDER BY queued_at DESC LIMIT 1').get(task.task_id);
      if (run) {
        report.runId = run.run_id;
        const state = `${task.phase}/${run.status}`;
        if (lastState !== state) { console.log(JSON.stringify({ marker, state })); lastState = state; }
        const outcomes: any[] = db.prepare('SELECT outcome_json FROM task_run_outcomes WHERE task_run_id=? ORDER BY created_at').all(run.run_id) as any;
        const reviewed = outcomes.map(row => JSON.parse(row.outcome_json)).filter(o => o.research);
        if (reviewed.length && !changed && run.status === 'running') {
          changed = true;
          await append('change', `对任务 ${marker} 增加要求：在原三份文件之外发布 change_notes.md，说明4条原始记录、2026-01和2026-02两个月及计算口径未改变，包含字面标记 REVISED-${marker}。传给同一执行任务，最终简短交付。`);
          report.injections.push({ type: 'requirement_change', at: new Date().toISOString() });
        }
        const adopted: any = db.prepare("SELECT entry_id FROM task_collaboration_entries WHERE task_id=? AND kind='instruction' AND body LIKE ?").get(task.task_id, `%REVISED-${marker}%`);
        if (adopted && reviewed.length >= 2 && !deletedUri && run.status === 'running') {
          const session: any = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id=?').get(run.conversation_id);
          const publications: any[] = db.prepare("SELECT payload_json FROM transcript_entries WHERE transcript_id=? AND role='toolResult' AND json_type(payload_json,'$.details.artifacts')='array' ORDER BY seq DESC").all(session.active_transcript_id) as any;
          const artifact = publications.flatMap(row => JSON.parse(row.payload_json).details.artifacts).find(a => a.title === 'report.md' && a.uri?.startsWith('media://outbound/'));
          if (artifact) {
            const id = decodeURIComponent(new URL(artifact.uri).pathname.slice(1));
            assert.ok(id && !/[\\/]/.test(id));
            const path = join(root, 'media', 'outbound', id);
            if (existsSync(path)) {
              assert.ok(readFileSync(path, 'utf8').includes('404'), 'Only the tagged research report may be deleted');
              unlinkSync(path); deletedUri = artifact.uri;
              report.injections.push({ type: 'published_test_file_loss', uri: deletedUri, at: new Date().toISOString() });
              console.log(JSON.stringify({ marker, injected: 'file_loss' }));
            }
          }
        }
        const delivery: any = db.prepare('SELECT * FROM task_result_deliveries WHERE task_run_id=?').get(run.run_id);
        if (delivery?.reply_status === 'delivered') { report.delivery = delivery; break; }
        if (['failed', 'cancelled'].includes(run.status)) throw new Error(`Run ${run.status}: ${run.terminal_message}`);
      }
    }
    if (!task && Date.now() - Date.parse(report.startedAt) > 60000) {
      const initial: any = db.prepare('SELECT status FROM session_inputs WHERE conversation_id=? AND client_message_id=?')
        .get(personal.conversation_id, `${marker}-task`);
      if (initial?.status === 'completed') throw new Error('Personal completed its reply without submitting the requested Task');
    }
    await sleep();
  }
  assert.ok(report.delivery, 'Daily delivery timeout');
  const outcome = JSON.parse(report.delivery.payload_json).outcome;
  report.outcome = outcome;
  report.reply = report.delivery.reply_text;
  delete report.delivery;
  assert.ok(changed && deletedUri, 'Both controlled injections must happen');
  assert.equal(outcome.research?.review, 'model_reviewed');
  assert.ok(outcome.research.sources.some(s => s.toolName === 'web_fetch' && s.url?.includes('developer.mozilla.org')));
  assert.ok(outcome.research.sources.every(s => s.toolCallId && /^[a-f0-9]{64}$/.test(s.snapshotHash)));
  assert.ok(outcome.research.claims.every(c => c.sourceIds.every(id => outcome.research.sources.some(s => s.id === id))));
  assert.ok(outcome.research.claims.every(c => c.support === 'supported' && c.sourceIds.length));
  assert.ok(outcome.research.checks.every(c => c.status === 'passed'));
  assert.ok(outcome.research.instructionChecks.some(c => c.status === 'passed'));
  const contents: Record<string, string> = {};
  for (const artifact of outcome.deliverables) {
    const url = base + `/api/media/read?uri=${encodeURIComponent(artifact.uri)}&conversationId=${personal.conversation_id}`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    contents[artifact.title] = bytes.toString('utf8');
    report.downloads.push({ title: artifact.title, uri: artifact.uri, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  for (const title of ['report.md', 'monthly_summary.csv', 'reproduce.mjs', 'change_notes.md']) assert.ok(contents[title], title);
  assert.ok(contents['change_notes.md'].includes(`REVISED-${marker}`));
  assert.ok(['150', '210', '40'].every(x => contents['report.md'].includes(x)));
  assert.ok(/404/.test(contents['report.md']) && /不能|无法|不.*永久|not.*permanent|does not/i.test(contents['report.md']));
  assert.ok(/冲突|次级|conflict|secondary/i.test(contents['report.md']));
  assert.notEqual(outcome.deliverables.find(a => a.title === 'report.md')?.uri, deletedUri);
  assert.ok(report.reply.length <= 600 && !/MEDIA:|file:\/\/|\/Users\//.test(report.reply));
  assert.ok(['150', '210', '40'].every(x => report.reply.includes(x)));
  assert.equal((db.prepare('SELECT count(*) n FROM task_runs WHERE task_id=?').get(task.task_id) as any).n, 1);
  report.receipts = db.prepare('SELECT verification_json FROM task_run_receipts WHERE run_id=?').all(run.run_id);
  report.sessionInputs = db.prepare('SELECT kind,status,payload_json FROM session_inputs WHERE task_run_id=?').all(run.run_id);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.sourceChangedDuringRun = JSON.stringify(sourceHashes) !== JSON.stringify(fingerprints());
  if (report.sourceChangedDuringRun) { report.passed = false; report.error ??= 'Relevant sources changed during verification'; process.exitCode = 1; }
  if (report.runId && !report.outcome) {
    const row: any = db.prepare('SELECT reply_text,payload_json FROM task_result_deliveries WHERE task_run_id=?').get(report.runId);
    if (row) {
      report.reply = row.reply_text;
      report.outcome = JSON.parse(row.payload_json).outcome;
      for (const artifact of report.outcome.deliverables.filter(a => a.uri)) {
        const url = base + `/api/media/read?uri=${encodeURIComponent(artifact.uri)}&conversationId=${personal.conversation_id}`;
        try {
          const anonymous = await fetch(url, { signal: AbortSignal.timeout(10000) });
          const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
          report.downloads.push({ title: artifact.title, uri: artifact.uri, availability: artifact.availability,
            status: response.status, anonymousStatus: anonymous.status,
            bytes: response.ok ? (await response.arrayBuffer()).byteLength : 0 });
        } catch (error) { report.downloads.push({ title: artifact.title, error: String(error) }); }
      }
    }
    report.sessionInputs = db.prepare('SELECT kind,status,error,payload_json FROM session_inputs WHERE task_run_id=?').all(report.runId);
    report.receipts = db.prepare('SELECT verification_json FROM task_run_receipts WHERE run_id=?').all(report.runId);
  }
  report.finishedAt = new Date().toISOString();
  if (report.runId) {
    report.modelCalls = db.prepare(`SELECT operation,model,status,error_summary FROM ai_usage_events
      WHERE conversation_id IN (SELECT conversation_id FROM task_runs WHERE run_id=?) ORDER BY started_at`).all(report.runId);
    report.runPolicy = db.prepare('SELECT status,retry_policy_json,policy_snapshot_json FROM task_runs WHERE run_id=?').get(report.runId);
    report.contract = db.prepare('SELECT acceptance_criteria_json FROM task_contracts WHERE task_id=? ORDER BY version DESC LIMIT 1').get(report.taskId);
  }
  mkdirSync(join(output, '..'), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
  db.close();
  console.log(JSON.stringify({ report: output, passed: report.passed, error: report.error }));
}
