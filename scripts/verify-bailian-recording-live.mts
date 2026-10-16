import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import type { Config } from '../src/config/schema.js';
import { DiscussionLiveWorker } from '../src/discussions/live-worker.js';
import { DiscussionSealer } from '../src/discussions/sealer.js';
import { DiscussionService } from '../src/discussions/service.js';
import { auth } from '../src/gateway/hono/middleware/auth.js';
import { gatewayScopes } from '../src/gateway/hono/middleware/scopes.js';
import { registerAuthenticatedLazyRouteFallback } from '../src/gateway/hono/routes/lazy-fallback.js';
import { NotesService, NotesStore } from '../src/notes/index.js';
import { ProjectService } from '../src/projects/index.js';
import { assertProviderUsage, getModelUsageOrigin, withModelUsageOrigin } from '../src/providers/model-usage.js';
import { getProviderAuthService } from '../src/providers/provider-auth-service.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/index.js';

// Read the saved credential before isolating recording storage. Never persist it in the report.
const config = JSON.parse(await readFile(process.env.XOPC_CONFIG_PATH ?? join(homedir(), '.xopc/xopc.json'), 'utf8')) as Config;
assert.equal(config.tools.media.audio.provider, 'qwen-token-plan-cn');
const key = await getProviderAuthService().resolveApiKey('qwen-token-plan-cn');
assert.ok(key);
process.env.QWEN_TOKEN_PLAN_CN_API_KEY = key;
const directory = await mkdtemp(join(tmpdir(), 'xopc-bailian-recording-'));
process.env.XOPC_STATE_DIR = directory;
process.env.XOPC_LOG_LEVEL = 'error';
openXopcDatabase({ path: join(directory, 'xopc.db') });
const notes = new NotesService(new NotesStore());
await notes.initialize();
const projects = new ProjectService();
const discussions = new DiscussionService(notes, projects);
const app = new Hono();
const token = randomUUID();
app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token, allowTailscale: false }) }));
app.use(gatewayScopes());
registerAuthenticatedLazyRouteFallback(app, {
  service: { discussions, notesServiceInstance: notes },
  strictRateLimitMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
} as never);
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const request = async (path: string, method = 'GET', body?: BodyInit, headers: Record<string, string> = {}) => {
  const response = await fetch(base + path, { method, body, headers: { authorization: `Bearer ${token}`, ...headers }, signal: AbortSignal.timeout(90_000) });
  assert.ok(response.ok, `Recording HTTP ${response.status}`);
  return response.json();
};
const json = (path: string, method: string, body: unknown) => request(path, method, JSON.stringify(body), { 'content-type': 'application/json' });
const pcmPath = process.argv.find(arg => arg.startsWith('--pcm='))?.slice(6);
assert.ok(pcmPath, 'Use --pcm=PCM16_MONO_16KHZ_FILE');
const pcm = await readFile(pcmPath);
const wav = Buffer.alloc(44 + pcm.length);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
const sha256 = createHash('sha256').update(wav).digest('hex');
const checks: unknown[] = [];
try {
  const settings = await request('/api/discussion-capture/settings');
  await json('/api/discussion-capture/settings', 'PUT', { consentPolicyVersion: settings.consentPolicyVersion });
  for (const mode of ['live', 'saved'] as const) {
    const created = await json('/api/discussions', 'POST', { clientRequestId: randomUUID(), source: 'web', consentPolicyVersion: settings.consentPolicyVersion });
    const id = created.discussion.id;
    if (mode === 'live') {
      const form = new FormData();
      form.set('file', new Blob([wav], { type: 'audio/wav' }), 'recording.wav');
      form.set('sha256', sha256); form.set('startedAtMs', '0'); form.set('endedAtMs', String(pcm.length / 32));
      await request(`/api/discussions/${id}/segments/0`, 'PUT', form);
      await new DiscussionLiveWorker({ notes, projects, getConfig: () => config }).tick();
    } else {
      await request(`/api/discussions/${id}/recording/chunks/0`, 'PUT', wav, { 'x-audio-sha256': sha256 });
      await json(`/api/discussions/${id}/capture/seal`, 'POST', { lastSequence: -1, chunkCount: 1, mimeType: 'audio/wav', fileName: 'recording.wav' });
      // A fresh worker simulates dispatch/recovery outside the original HTTP request.
      const restored = new DiscussionService(notes, projects);
      await new DiscussionSealer({ notes, getConfig: () => config, processRecordingJob: () => restored.processRecordingJob() }).tick();
    }
    const detail = await request(`/api/discussions/${id}`);
    const text = mode === 'live' ? detail.transcript.segments[0]?.rawText : detail.discussion.canonicalTranscript;
    assert.ok(text?.includes('测试成功'), `Missing recognized recording marker in ${mode}`);
    assert.equal(getModelUsageOrigin(), 'unknown');
    checks.push({ mode, passed: true, text, status: detail.discussion.status, provider: 'qwen-token-plan-cn' });
  }
  assert.throws(() => withModelUsageOrigin('background', () => withModelUsageOrigin('interactive', () => assertProviderUsage('qwen-token-plan-cn'))), /provider_usage_scope_denied/);
  checks.push({ mode: 'background', passed: true, deniedBeforeNetwork: true });
  await writeFile(join(directory, 'report.json'), JSON.stringify({ passed: true, date: new Date().toISOString(), isolatedState: true, configurationChanged: false, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, report: join(directory, 'report.json'), checks }));
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  closeXopcDatabase();
}
