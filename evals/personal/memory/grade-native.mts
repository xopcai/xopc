import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync, appendFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { run: { type: 'string' }, fixtures: { type: 'string' },
  out: { type: 'string' }, max: { type: 'string', default: '120' }, prior: { type: 'string' }, endpoint: { type: 'string' },
  evaluator: { type: 'string', default: '.xopc-evals/memory-upstream/evaluate_qa.py' },
  metadata: { type: 'string', default: '.xopc-evals/memory-upstream/evaluator-source.json' },
  formatter: { type: 'string', default: 'evals/personal/memory/format-native.py' },
  model: { type: 'string', default: 'xopc-cloud/openai-codex/gpt-6.1-sol' } } });
const root = process.cwd(), run = resolve(values.run!), fixtures = resolve(values.fixtures!), out = resolve(values.out!);
if (existsSync(out)) throw new Error('Refusing existing native QA output'); mkdirSync(out, { recursive: true });
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const save = (file: string, data: unknown) => writeFileSync(join(out, file), JSON.stringify(data, null, 2)+'\n');
const original = JSON.parse(readFileSync(join(run, 'manifest.json'), 'utf8'));
if (values.prior) {
  const previous = JSON.parse(readFileSync(join(values.prior, 'manifest.json'), 'utf8'));
  if (previous.capturedManifestHash !== sha(readFileSync(join(run, 'manifest.json')))) throw new Error('Prior native grades belong to another capture');
  if (!existsSync(join(values.prior, 'completion.json'))) throw new Error('Prior native cohort is incomplete');
}
const priorIds = new Set<string>(values.prior ? JSON.parse(readFileSync(join(values.prior, 'summary.json'), 'utf8')).results.map((r: any) => r.id) : []);
const targets = original.cases.filter((c: any) => c.suite.startsWith('longmemeval')).slice(0, Number(values.max)).filter((c: any) => !priorIds.has(c.id));
if (!targets.length) throw new Error('No LongMemEval targets');
const endpoint = JSON.parse(readFileSync(values.endpoint ?? join(run, 'pools/endpoint.json'), 'utf8'));
process.env.XOPC_STYLE_POOL_URL = endpoint.url; process.env.XOPC_STYLE_POOL_TOKEN = endpoint.token;
const originState = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const credentials = process.env.XOPC_CREDENTIALS_DIR ?? join(originState, 'credentials');
const config = process.env.XOPC_MEMORY_CONFIG_SNAPSHOT ? JSON.parse(readFileSync(process.env.XOPC_MEMORY_CONFIG_SNAPSHOT, 'utf8')).config : JSON.parse(readFileSync(process.env.XOPC_CONFIG_PATH ?? join(originState, 'xopc.json'), 'utf8'));
const state = mkdtempSync(join(tmpdir(), 'xopc-memory-native-'));
const configPath = join(state, 'xopc.json'); writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
if (existsSync(join(originState, 'cache/model-catalog'))) cpSync(join(originState, 'cache/model-catalog'), join(state, 'cache/model-catalog'), { recursive: true });
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath,
  XOPC_CREDENTIALS_DIR: credentials, XOPC_LOG_DIR: join(state, 'logs'), XOPC_LOG_LEVEL: 'warn', XOPC_LOG_CONSOLE: 'false' });
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
await load('src/infra/http-proxy-env.ts');
const { openXopcDatabase, closeXopcDatabase } = await load('src/storage/sqlite/index.ts');
const { AgentCatalogRepository } = await load('src/agent-catalog/repository.ts');
const { resolveModel } = await load('src/providers/index.ts');
const { completeWithResolvedCredentials } = await load('src/providers/model-call.ts');
const { installRequestProtocol } = await load('evals/personal/memory/request-protocol.mts');
const requestProtocol = installRequestProtocol({ out, expectedModel: values.model!, pool: 'judge', caseId: 'native-qa', phase: () => 'native_qa' });
openXopcDatabase({ path: join(out, 'usage.sqlite') });
const catalog = new AgentCatalogRepository(); catalog.ensureInitialized(); catalog.markProvisioned('main');
const resolved = resolveModel(values.model!);
save('manifest.json', { schemaVersion: 1, createdAt: new Date().toISOString(), model: values.model,
  prior: values.prior ? { path: resolve(values.prior), summaryHash: sha(readFileSync(join(values.prior, 'summary.json'))) } : null,
  captureRun: run, captureSourceHash: original.sourceHash, capturedManifestHash: sha(readFileSync(join(run, 'manifest.json'))),
  officialEvaluator: JSON.parse(readFileSync(values.metadata!, 'utf8')), formatterHash: sha(readFileSync(values.formatter!)),
  driverHash: sha(readFileSync(new URL(import.meta.url))), targetIds: targets.map((c: any) => c.id),
  protocol: 'Unchanged upstream get_anscheck_prompt via hash-checked AST; saved exact candidate answer; GPT6.1Sol judge; strict yes/no parser',
  settings: { reasoning: 'low', temperature: 0, maxTokens: 512, pool: 'shared judge4' },
  limitations: ['Time-consistent stratified120 subset, not full official500', 'Judge differs from upstream reference GPT4o',
    'No regeneration or grade-based retries; a final planned remaining cohort is separate'] });
const seen = new Set<string>(), active = new Set<Promise<void>>(), results: any[] = [];
function summarize() {
  const types: Record<string, any> = {};
  for (const r of results) {
    const t = types[r.category] ??= { total: 0, correct: 0, errors: 0 }; t.total++; t.correct += r.correct ? 1 : 0; t.errors += r.error ? 1 : 0;
  }
  save('summary.json', { target: targets.length, completed: results.length, types, results, costUsd: null });
}
async function grade(item: any) {
  const result: any = { id: item.id, category: item.category };
  try {
    const fixtureBytes = readFileSync(join(fixtures, item.id+'.json'));
    if (sha(fixtureBytes) !== item.sha256) throw new Error('Fixture hash mismatch');
    const fixture = JSON.parse(fixtureBytes.toString());
    const captureFile = join(run, 'cases', item.id, 'capture/result.json');
    const captureBytes = readFileSync(captureFile), captured = JSON.parse(captureBytes.toString());
    if (captured.error) throw new Error(captured.error);
    result.captureHash = sha(captureBytes); result.answerHash = sha(captured.answer); result.abstention = fixture.gold.abstention;
    const formatted = spawnSync('python3', [values.formatter!, values.evaluator!, values.metadata!], { encoding: 'utf8', input: JSON.stringify({
      type: item.category, question: fixture.query, answer: fixture.gold.answer, response: captured.answer, abstention: fixture.gold.abstention }) });
    if (formatted.status !== 0) throw new Error(formatted.stderr);
    const prompt = formatted.stdout.trimEnd();
    const dir = join(out, item.id); mkdirSync(dir);
    writeFileSync(join(dir, 'prompt.txt'), prompt);
    const response = await completeWithResolvedCredentials(resolved,
      { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] },
      { maxTokens: 512, reasoning: 'low', temperature: 0, signal: AbortSignal.timeout(240_000) }, undefined,
      { operation: 'memory_eval.native_qa', trigger: 'user' }).then(response => {
        if (response.errorMessage) {
          const raw = response.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
          writeFileSync(join(dir, 'raw.json'), JSON.stringify({ raw, usage: response.usage, error: response.errorMessage }, null, 2));
          throw new Error(response.errorMessage);
        }
        return response;
      });
    const raw = response.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    writeFileSync(join(dir, 'raw.json'), JSON.stringify({ raw, usage: response.usage, error: response.errorMessage }, null, 2));
    if (response.errorMessage || !/^(yes|no)[.!]?$/i.test(raw)) throw new Error(response.errorMessage ?? 'Invalid native yes/no judgment');
    result.correct = /^yes/i.test(raw);
  } catch (error) { result.error = String(error); result.correct = false; }
  results.push(result); appendFileSync(join(out, 'progress.jsonl'), JSON.stringify(result)+'\n'); summarize();
  console.log(`Native ${results.length}/${targets.length} ${item.id}: ${result.error ? 'ERROR' : result.correct ? 'YES' : 'NO'}`);
}
try {
  while (seen.size < targets.length) {
    let completed: any[] = [];
    try { completed = JSON.parse(readFileSync(join(run, 'summary.json'), 'utf8')).results; } catch {}
    for (const item of targets) {
      if (seen.has(item.id) || active.size >= 4) continue;
      const row = completed.find((r: any) => r.id === item.id); if (!row) continue;
      seen.add(item.id);
      const job = grade(item).finally(() => active.delete(job)); active.add(job);
    }
    if (seen.size === targets.length) break;
    if (existsSync(join(run, 'completion.json')) && !active.size && targets.some((i: any) => !seen.has(i.id))) {
      const missing = targets.filter((i: any) => !seen.has(i.id));
      for (const item of missing) { seen.add(item.id); const job = grade(item).finally(() => active.delete(job)); active.add(job); if (active.size >= 4) await Promise.race(active); }
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  await Promise.all(active); summarize();
  save('completion.json', { completed: results.length, target: targets.length, errors: results.filter(r => r.error).length,
    finishedAt: new Date().toISOString() });
} finally {
  await requestProtocol.close(); closeXopcDatabase(); rmSync(state, { recursive: true, force: true });
}
process.exit(results.some(r => r.error) ? 1 : 0);
