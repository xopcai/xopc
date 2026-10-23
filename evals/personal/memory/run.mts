import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { EvalStore, ArtifactStore } from '../../coder/packages/storage/src/index.js';
import { TraceEmitter } from '../../coder/packages/protocol/src/index.js';
import { freezeMemoryConfig } from './config-snapshot.mjs';
import { scoreEpisode } from './score-episodes.mjs';
import { provenanceCoverage } from './metrics.mjs';

const { values } = parseArgs({ options: { fixtures: { type: 'string', default: '.xopc-evals/memory-fixtures-v1' },
  out: { type: 'string' }, model: { type: 'string', default: 'xopc-cloud/openai-codex/gpt-5.6-sol' },
  judge: { type: 'string', default: 'xopc-cloud/openai-codex/gpt-6.1-sol' },
  suite: { type: 'string', default: 'all' }, limit: { type: 'string' }, 'dry-run': { type: 'boolean' }, 'config-snapshot': { type: 'string' }, endpoint: { type: 'string' }, label: { type: 'string', default: 'current' } } });
if (!values.out || !['all', 'longmemeval', 'chinese'].includes(values.suite!)) throw new Error('Specify --out and valid --suite');
const fixtures = resolve(values.fixtures!), out = resolve(values.out);
if (existsSync(out)) throw new Error('Refusing to overwrite an existing run');
mkdirSync(out, { recursive: true });
const selectionBytes = readFileSync(join(fixtures, 'selection.json'));
const selection = JSON.parse(selectionBytes.toString());
const sha = (s: Buffer | string) => createHash('sha256').update(s).digest('hex');
let cases = selection.cases.filter((c: any) => values.suite === 'all'
  || (values.suite === 'chinese' ? c.suite.startsWith('xopc') : c.suite.startsWith('longmemeval')));
if (values.limit) {
  if (!/^[1-9]\d*$/.test(values.limit)) throw new Error('Invalid --limit');
  cases = cases.slice(0, Number(values.limit));
}
// Deterministic interleaving exposes Chinese product failures without waiting for every long history.
const longCases = cases.filter((c: any) => c.suite.startsWith('longmemeval'));
const chineseCases = cases.filter((c: any) => c.suite.startsWith('xopc'));
cases = Array.from({ length: Math.max(longCases.length, chineseCases.length) }, (_, i) => [longCases[i], chineseCases[i]]).flat().filter(Boolean);
if (!cases.length) throw new Error('No cases selected');
const sourceHash = () => {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'packages', 'evals/personal/memory', 'evals/personal/style/request-pools.mts', 'evals/personal/style/request_pools.py', 'pnpm-lock.yaml'], { encoding: 'utf8' }).trim().split('\n');
  return sha(JSON.stringify([...new Set(paths)].sort().map(p => [p, sha(readFileSync(p))])));
};
const manifest = { version: 2, variant: values.label, suite: 'personal-memory-baseline', createdAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHash: sourceHash(),
  selectionHash: sha(selectionBytes), models: { candidate: values.model, extractor: values.model, judge: values.judge },
  reasoning: { candidate: 'off', extractor: 'off', judge: 'low' }, diagnosticVersion: 3,
  pools: { generation: 4, judge: 4, independent: true }, cases,
  protocol: 'Full history imported through SQLite transcript API; production runPersistentLearningJob; complete-state QA through authenticated Personal Gateway/realtime. No gold in candidate worker. Fresh isolated DB per question.',
  limitations: ['Paired source-frozen product comparison when labels A/B are supplied; no no-memory/oracle condition',
    'Forced learning flush measures completed-state quality, not natural learning latency',
    'Historical question timestamp is separate provider system context; retrieval and current author see the plain question; host wall clock stays real',
    'Imported history rows keep original roles/dates; live controls generate and learn actual foreground replies',
    'Inference errors are retained; internal production schema correction remains enabled',
    'Model routing aliases do not pin underlying provider weights',
    'Stage attribution is evidence-checked diagnostic judgment, not proof of the exact internal cause'] };
const save = (name: string, data: any) => writeFileSync(join(out, name), JSON.stringify(data, null, 2)+'\n');
save('manifest.json', manifest);
if (values['dry-run']) { console.log(JSON.stringify({ out, cases: cases.length, ...manifest.models })); process.exit(0); }

const frozenConfig = freezeMemoryConfig(values['config-snapshot']);
Object.assign(manifest, { protocolVersion: 6, questionTimeTransport: 'provider-system-context-v1', configSnapshotHash: frozenConfig.hash, physicalRequestPools: true, liveEvidenceIncluded: true, autonomousBackground: 'task dispatch disabled by host option; home disabled; memory scheduler stopped', isolatedDefaultWorkspace: true, judgeServiceRetries: { maximum: 2, onlyEmptyTransportErrors: true, candidateRegeneration: false } });
save('manifest.json', manifest);
const poolDir = join(out, 'pools');
const pool = values.endpoint ? undefined : spawn('python3', ['evals/personal/style/request_pools.py', '--out', poolDir], { stdio: ['ignore', 'ignore', 'inherit'] });
const endpointFile = values.endpoint ? resolve(values.endpoint) : join(poolDir, 'endpoint.json');
for (let i = 0; !existsSync(endpointFile); i++) {
  if (i > 200 || (pool && pool.exitCode !== null)) throw new Error('Request pool startup failed');
  await new Promise(r => setTimeout(r, 100));
}
const endpoint = JSON.parse(readFileSync(endpointFile, 'utf8'));
const environment = { ...process.env, XOPC_MEMORY_VARIANT: values.label, XOPC_MEMORY_CONFIG_SNAPSHOT: frozenConfig.path, XOPC_MEMORY_CONFIG_HASH: frozenConfig.hash, XOPC_STYLE_POOL_URL: endpoint.url, XOPC_STYLE_POOL_TOKEN: endpoint.token };
class Queue {
  active = 0; pending: Array<() => void> = [];
  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.active >= 4) await new Promise<void>(r => this.pending.push(r));
    else this.active++;
    try { return await action(); }
    finally { const next = this.pending.shift(); if (next) next(); else this.active--; }
  }
}
const generation = new Queue(), judge = new Queue();
const store = new EvalStore(join(out, 'evals.db')), artifacts = new ArtifactStore(join(out, 'artifacts'));
const experimentId = randomUUID();
store.createExperiment({ id: experimentId, name: 'Current XOPC memory baseline', suiteId: 'personal-memory', suiteVersion: '1.0.0',
  suiteHash: manifest.selectionHash, spec: { name: 'Memory baseline', variants: [{ id: 'current', adapter: 'personal-memory',
    model: values.model, config: { judge: values.judge } }], repetitions: 1 } });
const worker = (mode: string, input: string, target: string) => new Promise<void>((resolveJob, reject) => {
  mkdirSync(target, { recursive: true });
  const fd = openSync(join(target, 'worker.log'), 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', 'evals/personal/memory/worker.mts', '--mode', mode,
    '--input', input, '--out', target, '--model', values.model!, '--judge', values.judge!], { env: environment, stdio: ['ignore', fd, fd] });
  const timer = setTimeout(() => child.kill('SIGKILL'), 3_600_000);
  child.once('error', err => { clearTimeout(timer); closeSync(fd); reject(err); });
  child.once('exit', code => { clearTimeout(timer); closeSync(fd); code === 0 ? resolveJob() : reject(new Error(`Worker ${mode} exited ${code}`)); });
});
const results: any[] = [];
const summarize = () => {
  const categories: Record<string, any> = {}, stages: Record<string, number> = {};
  for (const result of results) {
    const key = `${result.suite}/${result.category}`;
    const row = categories[key] ??= { total: 0, correct: 0, errors: 0 };
    row.total++; row.correct += result.judgment?.correct ? 1 : 0; row.errors += result.error ? 1 : 0;
    const stage = result.error ? 'infrastructure_or_protocol_error' : result.judgment.attribution;
    stages[stage] = (stages[stage] ?? 0)+1;
  }
  save('summary.json', { scheduled: cases.length, completed: results.length, categories, stages, results,
    sourceChanged: sourceHash() !== manifest.sourceHash, costUsd: null });
};
try {
  await Promise.all(cases.map(async (item: any) => {
    const dir = join(out, 'cases', item.id), runId = randomUUID(); mkdirSync(dir, { recursive: true });
    store.createRun({ id: runId, experimentId, variantId: 'current', adapter: 'personal-memory', sourceCommit: manifest.commit,
      fixtureCommit: item.sha256, evalCase: { id: item.id, task: 'Personal memory diagnostic baseline',
        repo: { source: 'local', path: dir, commit: manifest.commit }, budget: { timeoutMs: 3_600_000 }, graders: [], tags: [item.suite, item.category] } });
    const trace = new TraceEmitter(runId, event => store.appendEvent(event));
    await trace.emit('run.started', { caseId: item.id, suite: item.suite });
    const result: any = { id: item.id, suite: item.suite, category: item.category };
    try {
      const bytes = readFileSync(join(fixtures, item.id+'.json')); if (sha(bytes) !== item.sha256) throw new Error('Fixture modified');
      const { gold, ...publicCase } = JSON.parse(bytes.toString());
      const publicPath = join(dir, 'input.json'); writeFileSync(publicPath, JSON.stringify(publicCase));
      await generation.run(() => worker('capture', publicPath, join(dir, 'capture')));
      const captured = JSON.parse(readFileSync(join(dir, 'capture/result.json'), 'utf8'));
      await trace.emit('model.response', { role: 'candidate', content: captured.answer, model: values.model,
        batches: captured.batches, learningErrors: captured.learningErrors, receipts: join(dir, 'capture') });
      if (captured.error) throw new Error(captured.error);
      const learning = JSON.parse(readFileSync(join(dir, 'capture/learning.json'), 'utf8'));
      result.provenance = provenanceCoverage(gold.evidenceRefs, learning, captured.auditItems, captured.toolText);
      const sourceEvidence = publicCase.sessions.flatMap((s: any) => s.messages.filter((m: any) => gold.evidenceRefs.includes(m.id)));
      const sourceContext = publicCase.sessions.filter((s: any) => gold.evidenceSessionIds.includes(s.id));
      const liveFile = join(dir, 'capture/live-control.json');
      const live = existsSync(liveFile) ? JSON.parse(readFileSync(liveFile, 'utf8')) : null;
      for (const [index, turn] of (live?.liveReceipts ?? []).entries()) {
        const messages = turn.transcript.map((row: any) => ({ id: row.entry_id, role: row.role, content: JSON.parse(row.payload_json), timestamp: row.created_at }));
        sourceContext.push({ id: `actual-live-${index}`, messages });
        sourceEvidence.push(...messages.filter((row: any) => row.role === 'user'));
      }
      const protocol = JSON.parse(readFileSync(join(dir, 'capture/protocol-audit.json'), 'utf8'));
      if (!protocol.valid) throw new Error('Capture protocol audit failed');
      if (gold.episode) {
        result.episode = scoreEpisode(gold.episode, join(dir, 'capture'));
        save(`cases/${item.id}/episode-checks.json`, result.episode);
      }
      const gradeInput = { id: item.id, query: publicCase.query, queryTime: publicCase.queryTime, gold,
        sourceEvidence, sourceContext, answer: captured.answer, storedText: captured.storedText, selectedText: captured.selectedText,
        toolText: captured.toolText, learningErrors: captured.learningErrors, diagnosticsTruncated: false, liveEvidence: live };
      const gradePath = join(dir, 'judge-input.json'); writeFileSync(gradePath, JSON.stringify(gradeInput));
      let judgeDir = join(dir, 'judge');
      result.judgeAttempts = [];
      await judge.run(async () => {
        for (let attempt = 0; ; attempt++) {
          judgeDir = join(dir, attempt ? `judge-service-retry-${attempt}` : 'judge');
          try {
            await worker('judge', gradePath, judgeDir);
            result.judgeAttempts.push({ directory: judgeDir, status: 'completed' });
            break;
          } catch (error) {
            result.judgeAttempts.push({ directory: judgeDir, status: 'error', error: String(error) });
            const rawFile = join(judgeDir, 'raw.json');
            const raw = existsSync(rawFile) ? JSON.parse(readFileSync(rawFile, 'utf8')) : null;
            if (attempt >= 2 || !raw || String(raw.raw ?? '').trim()
              || !/overload|rate.?limit|429|timed?\s*out|timeout|provider_error|502|503/iu.test(raw.error ?? '')) throw error;
            await new Promise(resolve => setTimeout(resolve, 10_000));
          }
        }
      });
      result.judgeSelected = judgeDir;
      const judgeProtocol = JSON.parse(readFileSync(join(judgeDir, 'protocol-audit.json'), 'utf8'));
      if (!judgeProtocol.valid) throw new Error('Judge protocol audit failed');
      result.judgment = JSON.parse(readFileSync(join(judgeDir, 'result.json'), 'utf8'));
      await trace.emit('model.response', { role: 'judge', ...result.judgment });
      const artifact = artifacts.putText(runId, 'memory-result', JSON.stringify(result), 'application/json'); store.recordArtifact(artifact);
      store.recordGrade(runId, { graderIndex: 0, graderType: 'external_model_judge', category: 'quality', required: true,
        weight: 1, passed: result.judgment.correct, score: Number(result.judgment.correct), summary: result.judgment.reason,
        artifactRefs: [artifact.id], durationMs: result.judgment.durationMs });
      store.completeRun(runId, { status: result.judgment.correct ? 'passed' : 'failed', finalText: captured.answer, score: Number(result.judgment.correct) });
      await trace.emit('run.completed', { correct: result.judgment.correct, attribution: result.judgment.attribution });
    } catch (error) {
      result.error = String(error); store.completeRun(runId, { status: 'error', finalText: '', error: result.error, score: 0 });
      await trace.emit('run.failed', { error: result.error });
    }
    results.push(result); appendFileSync(join(out, 'progress.jsonl'), JSON.stringify({ ...result, at: Date.now() })+'\n');
    summarize(); console.log(`${results.length}/${cases.length} ${item.id}: ${result.error ? 'ERROR' : result.judgment.correct ? 'QA_PASS' : result.judgment.attribution}${result.episode ? result.episode.passed ? ' EPISODE_PASS' : ' EPISODE_FAIL' : ''}`);
  }));
  summarize();
  const unchanged = sourceHash() === manifest.sourceHash;
  save('completion.json', { sourceChanged: !unchanged, sourceHashEnd: sourceHash(), completed: results.length,
    scheduled: cases.length, errors: results.filter(r => r.error).length, finishedAt: new Date().toISOString() });
  store.completeExperiment(experimentId, unchanged && !results.some(r => r.error) ? 'completed' : 'failed');
  if (!unchanged || results.some(r => r.error)) process.exitCode = 1;
} finally {
  const status = await fetch(endpoint.url+'/status', { method: 'POST', headers: { Authorization: `Bearer ${endpoint.token}`, 'Content-Type': 'application/json' }, body: '{}' });
  save('pool-status.json', await status.json());
  pool?.kill('SIGINT'); store.close(); frozenConfig.close();
}
