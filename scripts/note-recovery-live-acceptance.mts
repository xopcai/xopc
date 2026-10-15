/** Opt-in real-provider acceptance with isolated synthetic audio and process-local HTTP faults. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.XOPC_NOTE_LIVE, '1', 'Set XOPC_NOTE_LIVE=1 to authorize real STT/LLM calls');
const childMode = process.argv[2];
const directory = process.env.XOPC_NOTE_ACCEPTANCE_DIR ?? mkdtempSync(join(tmpdir(), 'xopc-note-live-'));
process.env.XOPC_STATE_DIR = directory;
process.env.XOPC_CONFIG_PATH = join(directory, 'xopc.json');
process.env.XOPC_CONFIG = process.env.XOPC_CONFIG_PATH;
process.env.XOPC_WORKSPACE = join(directory, 'workspace');
process.env.XOPC_LOG_DIR = join(directory, 'logs');
process.env.XOPC_LOG_LEVEL = 'fatal';
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
type Evidence = { mode: string; status: string; checkpoints: number; attempts: number; nextAttemptAt?: number;
  calls: Array<{ stage: string; outcome: string; status?: number; requestId?: string }>; audioHash: string; noteId: string;
  summaryCharacters: number; transcriptCharacters: number; failure?: string; leaseUntil?: number; markdown: string };

if (!childMode) {
  assert.ok(process.env.DASHSCOPE_API_KEY, 'DASHSCOPE_API_KEY is required');
  assert.ok(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY is required');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'xopc.json'), '{}', { mode: 0o600 });
  const reportPath = resolve(process.env.XOPC_NOTE_ACCEPTANCE_REPORT ?? 'docs/design/technical/note-recovery-live-2026-10-15.json');
  const evidence: Evidence[] = [];
  const sourceHashes = Object.fromEntries(['src/discussions/sealer.ts', 'src/discussions/processing.ts',
    'src/discussions/organizer-worker.ts', 'src/discussions/analyzer.ts', 'src/media-shared/http/provider-http.ts',
    'scripts/note-recovery-live-acceptance.mts'].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
  const report = { date: new Date().toISOString(), directory, source: 'Synthetic macOS speech, 45 seconds PCM WAV',
    stt: 'alibaba/qwen-audio-3.1-asr-flash', model: 'deepseek/deepseek-flash',
    boundary: 'Real provider successes; socket disconnection and HTTP 429 injected on loopback only. No device testing or induced supplier quota exhaustion.',
    sourceHashes, node: process.version, passed: false, evidence, failure: undefined as string | undefined };
  const saveReport = () => {
    mkdirSync(resolve(reportPath, '..'), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  };
  const run = (mode: string, kill = false) => new Promise<Evidence>((done, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), mode], {
      env: { ...process.env, XOPC_NOTE_ACCEPTANCE_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = ''; let result: Evidence | undefined; let killed = false;
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${mode} exceeded 240 seconds`)); }, 240_000);
    child.stdout.on('data', bytes => { output = (output + String(bytes)).slice(-8_000); });
    child.stderr.on('data', bytes => { output = (output + String(bytes)).slice(-8_000); });
    child.on('message', (message: { event?: string; evidence?: Evidence }) => {
      if (message.evidence) result = message.evidence;
      if (kill && message.event === 'kill-boundary') { killed = true; child.kill('SIGKILL'); }
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (killed && signal === 'SIGKILL' && result) { evidence.push(result); saveReport(); console.log(`${mode}: SIGKILL after ${result.checkpoints} checkpoints`); done(result); }
      else if (code === 0 && result) { evidence.push(result); saveReport(); console.log(`${mode}: ${result.status}, checkpoints=${result.checkpoints}, attempts=${result.attempts}`); done(result); }
      else reject(new Error(`${mode} failed (${code}/${signal}): ${output}`));
    });
  });
  try {
    const words = 'This is a synthetic reliability acceptance recording. We decided to retain original audio. Alice will verify restart recovery tomorrow. Bob will test transcription retries. The deadline remains Friday. There are no customer recordings in this test. ';
    execFileSync('say', ['-v', 'Samantha', '-r', '150', '-o', join(directory, 'speech.aiff'), words.repeat(4)]);
    execFileSync(process.env.XOPC_FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-y', '-i', join(directory, 'speech.aiff'), '-t', '45', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', join(directory, 'original.wav')]);
    await run('seed');
    const first = await run('stt-network');
    assert.equal(first.checkpoints, 1); assert.equal(first.attempts, 1); assert.equal(first.status, 'sealing');
    await sleep(Math.max(0, first.nextAttemptAt! - Date.now() + 50));
    const limited = await run('stt-rate-limit'); assert.equal(limited.checkpoints, 1); assert.equal(limited.attempts, 2);
    await sleep(Math.max(0, limited.nextAttemptAt! - Date.now() + 50));
    const killed = await run('stt-kill', true); assert.equal(killed.checkpoints, 2);
    const leased = await run('stt-before-lease-expiry'); assert.equal(leased.calls.length, 0); assert.equal(leased.checkpoints, 2);
    console.log('Waiting for the actual persisted transcription lease to expire');
    await sleep(Math.max(0, killed.leaseUntil! - Date.now() + 100));
    const recovered = await run('stt-recover'); assert.equal(recovered.status, 'organizing'); assert.equal(recovered.calls.length, 1); assert.equal(recovered.checkpoints, 3);
    const modelKilled = await run('llm-kill', true); assert.equal(modelKilled.status, 'organizing'); assert.equal(modelKilled.attempts, 0);
    const modelLeased = await run('llm-before-lease-expiry'); assert.equal(modelLeased.calls.length, 0);
    console.log('Waiting for the actual persisted organization lease to expire');
    await sleep(Math.max(0, modelKilled.leaseUntil! - Date.now() + 100));
    const modelLimited = await run('llm-rate-limit'); assert.equal(modelLimited.status, 'organizing'); assert.equal(modelLimited.attempts, 1);
    await sleep(Math.max(0, modelLimited.nextAttemptAt! - Date.now() + 50));
    const modelNetwork = await run('llm-network'); assert.equal(modelNetwork.status, 'organizing'); assert.equal(modelNetwork.attempts, 2);
    await sleep(Math.max(0, modelNetwork.nextAttemptAt! - Date.now() + 50));
    const final = await run('llm-recover'); assert.equal(final.status, 'completed'); assert.ok(final.summaryCharacters > 0);
    assert.ok(final.calls.length > 0 && final.calls.every(call => call.stage === 'llm'));
    assert.ok(evidence.every(item => item.audioHash === first.audioHash && item.noteId === first.noteId && item.markdown === 'Independent acceptance notes'));
    report.passed = true;
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error); process.exitCode = 1;
  } finally {
    saveReport();
    console.log(JSON.stringify({ passed: report.passed, reportPath, failure: report.failure }));
  }
} else {
  const { openXopcDatabase, closeXopcDatabase } = await import('../src/storage/sqlite/index.js');
  const { getSqliteDatabase } = await import('../src/storage/sqlite/transaction.js');
  const { AgentCatalogRepository } = await import('../src/agent-catalog/repository.js');
  const { ConfigSchema } = await import('../src/config/schema.js');
  const { NotesService, NotesStore } = await import('../src/notes/index.js');
  const { ProjectService } = await import('../src/projects/index.js');
  const { DiscussionService } = await import('../src/discussions/service.js');
  const { DiscussionSealer } = await import('../src/discussions/sealer.js');
  const { DiscussionOrganizer } = await import('../src/discussions/organizer.js');
  const { DiscussionOrganizerWorker } = await import('../src/discussions/organizer-worker.js');
  const { processingProgress, getProcessingRun } = await import('../src/discussions/processing.js');
  openXopcDatabase({ path: join(directory, 'xopc.db') });
  const catalog = new AgentCatalogRepository(); catalog.ensureInitialized();
  const settings = catalog.getSettings();
  if (settings.defaults.models.chat.primary !== 'deepseek/deepseek-flash') catalog.updateDefaults({ ...settings.defaults,
    models: { ...settings.defaults.models, chat: { primary: 'deepseek/deepseek-flash', fallbacks: [] } } }, settings.revision);
  if (catalog.get(settings.defaultAgentId)?.provisioningState !== 'ready') catalog.markProvisioned(settings.defaultAgentId);
  const config = ConfigSchema.parse({ tools: { media: { audio: { enabled: true, provider: 'alibaba',
    providers: { alibaba: { model: 'qwen-audio-3.1-asr-flash' } }, fallback: { enabled: false, order: [] } } } } });
  const notes = new NotesService(new NotesStore()); await notes.initialize(); const projects = new ProjectService();
  const service = new DiscussionService(notes, projects);
  const calls: Evidence['calls'] = [];
  let id = childMode === 'seed' ? '' : readFileSync(join(directory, 'discussion-id'), 'utf8');
  const snapshot = async (): Promise<Evidence> => {
    const detail = (await service.get(id))!; const audio = await notes.getAttachmentPath(detail.note.id, detail.discussion.audioAttachmentId!);
    const progress = processingProgress(id);
    return { mode: childMode, status: detail.discussion.status, checkpoints: progress?.completedChunks ?? 0,
      attempts: progress?.attemptCount ?? 0, nextAttemptAt: progress?.nextAttemptAt, calls,
      audioHash: createHash('sha256').update(readFileSync(audio!.filePath)).digest('hex'), noteId: detail.note.id,
      summaryCharacters: detail.organization?.organization?.summary.length ?? 0, transcriptCharacters: detail.discussion.canonicalTranscript?.length ?? 0,
      failure: detail.discussion.failureMessage, leaseUntil: childMode.startsWith('llm-')
        ? (getSqliteDatabase().prepare('SELECT work_lease_expires_at AS deadline FROM discussion_captures WHERE id=?').get(id) as { deadline: number | null }).deadline ?? undefined
        : getProcessingRun(id)?.lease_until ?? undefined,
      markdown: (await notes.getNote(detail.note.id))!.markdown };
  };
  const rawFetch = globalThis.fetch;
  const sockets = new Set<import('node:net').Socket>();
  const faultServer = createServer((request, response) => {
    request.resume();
    if (childMode.endsWith('network')) request.socket.destroy();
    else if (childMode.endsWith('-kill')) { void snapshot().then(evidence => process.send?.({ event: 'kill-boundary', evidence })); }
    else { response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' }); response.end(JSON.stringify({ error: { message: 'Acceptance injected rate limit', type: 'rate_limit_error', code: 'rate_limit_exceeded' } })); }
  });
  faultServer.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(done => faultServer.listen(0, '127.0.0.1', done));
  const faultUrl = `http://127.0.0.1:${(faultServer.address() as import('node:net').AddressInfo).port}`;
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    const stage = url.hostname === 'dashscope.aliyuncs.com' ? 'stt' : url.hostname === 'api.deepseek.com' ? 'llm' : undefined;
    if (!stage) return rawFetch(input, init);
    requests++;
    const fault = childMode === `${stage}-rate-limit` || childMode === 'llm-network' || childMode === 'llm-kill'
      || (childMode === 'stt-network' && requests > 1) || (childMode === 'stt-kill' && requests > 1);
    const entry: Evidence['calls'][number] = { stage, outcome: fault ? childMode : 'supplier' }; calls.push(entry);
    try {
      // Never forward credentials or audio to the fault listener.
      const response = fault ? await rawFetch(faultUrl, { signal: init?.signal }) : await rawFetch(input, init);
      entry.status = response.status;
      entry.requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined;
      return response;
    } catch (error) { entry.outcome += ':transport-failure'; throw error; }
  };
  try {
    if (childMode === 'seed') {
      service.acknowledgeConsent(service.settings().consentPolicyVersion);
      const detail = await service.create({ clientRequestId: crypto.randomUUID(), source: 'web', consentPolicyVersion: service.settings().consentPolicyVersion });
      id = detail.discussion.id; writeFileSync(join(directory, 'discussion-id'), id);
      await notes.updateNote(detail.note.id, { markdown: 'Independent acceptance notes' });
      const buffer = readFileSync(join(directory, 'original.wav'));
      await service.uploadRecordingChunk(id, 0, createHash('sha256').update(buffer).digest('hex'), new Blob([buffer]).stream());
      await service.sealRecording(id, { chunkCount: 1, mimeType: 'audio/wav', fileName: 'original.wav', lastSequence: -1 });
      await service.processRecordingJob();
    } else if (childMode.startsWith('stt-')) {
      const worker = new DiscussionSealer({ notes, getConfig: () => config });
      await worker.tick();
      if (childMode === 'stt-network') {
        const before = calls.length;
        assert.ok(processingProgress(id)?.nextAttemptAt! > Date.now(), 'Retry deadline must be in the future');
        await worker.tick(); assert.equal(calls.length, before, 'Backoff must gate a second tick');
      }
    } else {
      await new DiscussionOrganizerWorker(new DiscussionOrganizer({ notes, projects, getConfig: () => config })).tick();
    }
    process.send?.({ evidence: await snapshot() });
  } finally {
    globalThis.fetch = rawFetch; sockets.forEach(socket => socket.destroy()); await new Promise<void>(done => faultServer.close(() => done()));
    closeXopcDatabase(); process.disconnect?.();
  }
}
