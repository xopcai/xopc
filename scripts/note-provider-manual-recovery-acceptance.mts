/** Real-provider recovery after retry exhaustion, through authenticated lazy Gateway routes. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

assert.equal(process.env.XOPC_NOTE_LIVE, '1', 'Set XOPC_NOTE_LIVE=1 for real supplier calls');
assert.ok(process.env.DASHSCOPE_API_KEY && process.env.DEEPSEEK_API_KEY, 'STT and model credentials are required');
const directory = mkdtempSync(join(tmpdir(), 'xopc-note-manual-live-'));
Object.assign(process.env, { XOPC_STATE_DIR: directory, XOPC_CONFIG: join(directory, 'xopc.json'), XOPC_CONFIG_PATH: join(directory, 'xopc.json'), XOPC_WORKSPACE: join(directory, 'workspace'), XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_DIR: join(directory, 'logs') });
writeFileSync(join(directory, 'xopc.json'), '{}', { mode: 0o600 });
const reportPath = resolve(process.env.XOPC_NOTE_MANUAL_REPORT ?? 'docs/design/technical/note-provider-manual-recovery-2026-10-16.json');
type Snapshot = { mode: string; status: string; nextAttemptAt?: number; attempts: number; checkpoints: number; noteId: string; audioHash: string; markdown: string; calls: Array<{ stage: string; outcome: string; status?: number }> };
const stages: Snapshot[] = [];
const http: Array<{ operation: string; status: number }> = [];
const report = { passed: false, date: new Date().toISOString(), directory, syntheticSpeech: true, realProviders: true, faults: 'Loopback socket close and HTTP 429; successful requests reach real suppliers', stages, http, failure: undefined as string | undefined };
const persist = () => { mkdirSync(resolve(reportPath, '..'), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); };
const run = (mode: string) => new Promise<Snapshot>((done, reject) => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/note-recovery-live-acceptance.mts', mode], { env: { ...process.env, XOPC_NOTE_ACCEPTANCE_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let result: Snapshot | undefined; let output = '';
  const timeout = setTimeout(() => child.kill('SIGKILL'), 240_000);
  child.on('message', (message: { evidence?: Snapshot }) => { result = message.evidence ?? result; });
  child.stdout.on('data', bytes => { output = (output + bytes).slice(-4000); });
  child.stderr.on('data', bytes => { output = (output + bytes).slice(-4000); });
  child.on('error', reject);
  child.on('exit', code => { clearTimeout(timeout); if (code === 0 && result) { stages.push(result); persist(); console.log(`${mode}: ${result.status}, attempts=${result.attempts}, checkpoints=${result.checkpoints}`); done(result); } else reject(new Error(`${mode} exited ${code}: ${output}`)); });
});
const due = async (row: Snapshot) => {
  if (row.nextAttemptAt) await new Promise(done => setTimeout(done, Math.max(0, row.nextAttemptAt! - Date.now() + 100)));
};
let server: ReturnType<typeof import('@hono/node-server').serve> | undefined;
let closeDatabase: (() => void) | undefined;
try {
  execFileSync('say', ['-v', 'Samantha', '-r', '150', '-o', join(directory, 'speech.aiff'), 'Synthetic reliability acceptance. Keep original audio safe. Alice will test restart recovery tomorrow. Bob will verify transcription and note retries. The deadline remains Friday. '.repeat(5)]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(directory, 'speech.aiff'), '-t', '45', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', join(directory, 'original.wav')]);
  await run('seed');
  const first = await run('stt-network'); assert.equal(first.checkpoints, 1); await due(first);
  const limited = await run('stt-rate-limit'); assert.equal(limited.attempts, 2); await due(limited);
  const exhausted = await run('stt-rate-limit'); assert.equal(exhausted.status, 'needs_attention'); assert.equal(exhausted.checkpoints, 1); assert.equal(exhausted.attempts, 3);
  const { readFileSync } = await import('node:fs'); const id = readFileSync(join(directory, 'discussion-id'), 'utf8');
  const { Hono } = await import('hono'); const { serve } = await import('@hono/node-server');
  const { openXopcDatabase, closeXopcDatabase } = await import('../src/storage/sqlite/index.js'); openXopcDatabase({ path: join(directory, 'xopc.db') }); closeDatabase = closeXopcDatabase;
  const { NotesService, NotesStore } = await import('../src/notes/index.js'); const notes = new NotesService(new NotesStore()); await notes.initialize();
  const { ProjectService } = await import('../src/projects/index.js');
  const { DiscussionService } = await import('../src/discussions/service.js'); const discussions = new DiscussionService(notes, new ProjectService());
  const { auth } = await import('../src/gateway/hono/middleware/auth.js'); const { gatewayScopes } = await import('../src/gateway/hono/middleware/scopes.js');
  const { registerAuthenticatedLazyRouteFallback } = await import('../src/gateway/hono/routes/lazy-fallback.js');
  const app = new Hono(); const token = randomUUID();
  app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token, allowTailscale: false }) })); app.use(gatewayScopes());
  registerAuthenticatedLazyRouteFallback(app, { service: { discussions, notesServiceInstance: notes }, strictRateLimitMiddleware: async (_c: unknown, next: () => Promise<void>) => next() } as never);
  server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }); if (!server.listening) await new Promise<void>(done => server!.once('listening', done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const unauthorized = await fetch(`${base}/api/discussions/${id}/retry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  http.push({ operation: 'unauthenticated retry denied', status: unauthorized.status }); assert.equal(unauthorized.status, 401);
  const retry = async (stage: 'sealing' | 'organizing') => {
    const response = await fetch(`${base}/api/discussions/${id}/retry`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'resume' }), signal: AbortSignal.timeout(30_000) });
    http.push({ operation: `${stage} resume through authenticated lazy route`, status: response.status }); assert.equal(response.status, 200);
    const payload = await response.json() as { discussion: { status: string } };
    assert.equal(payload.discussion.status, stage);
  };
  await retry('sealing'); const restored = await run('stt-recover'); assert.equal(restored.status, 'organizing'); assert.equal(restored.checkpoints, 3); assert.equal(restored.calls.length, 2);
  for (let index = 1; index <= 3; index++) { const row = await run('llm-rate-limit'); assert.equal(row.attempts, index); assert.equal(row.status, index === 3 ? 'needs_attention' : 'organizing'); await due(row); }
  await retry('organizing'); const final = await run('llm-recover'); assert.equal(final.status, 'completed'); assert.ok(final.calls.length > 0 && final.calls.every(call => call.stage === 'llm'));
  assert.ok(stages.every(row => row.noteId === first.noteId && row.audioHash === first.audioHash && row.markdown === 'Independent acceptance notes'));
  report.passed = true;
} catch (error) { report.failure = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally { if (server) await new Promise<void>((done, reject) => server!.close(error => error ? reject(error) : done())); closeDatabase?.(); persist(); console.log(JSON.stringify({ passed: report.passed, reportPath, failure: report.failure })); }
