import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { run: { type: 'string' }, out: { type: 'string' } } });
if (!values.run || !values.out) throw new Error('Pass --run and a new --out');
const run = resolve(values.run), out = resolve(values.out);
if (existsSync(out)) throw new Error('Refusing to overwrite recovery evidence');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = read(join(run, 'manifest.json'));
if (read(join(run, 'completion.json')).sourceChanged) throw new Error('Capture source changed');
const eligible = readdirSync(join(run, 'cases')).filter(n => /^FB-.*\.json$/.test(n)).map(name => ({ path: join(run, 'cases', name), row: read(join(run, 'cases', name)) }))
  .filter(({ row }) => row.error && row.answer && row.judgePrompt && !row.verdicts);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'registration.json'), JSON.stringify({ createdAt: new Date().toISOString(), sourceRun: run, judge: manifest.judge,
  policy: 'One supplemental judge call for each captured answer lacking a valid grade. Reuse the exact saved official judge prompt and model parameters. Never regenerate candidate answers or overwrite original errors. Retain failures; report original and supplemented summaries separately.',
  candidates: eligible.map(({ path, row }) => ({ caseId: row.caseId, originalError: row.error, sourceSha256: createHash('sha256').update(readFileSync(path)).digest('hex') })) }, null, 2));
const sourceState = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const configPath = process.env.XOPC_CONFIG_PATH ?? join(sourceState, 'xopc.json');
const credentials = process.env.XOPC_CREDENTIALS_DIR ?? join(sourceState, 'credentials');
const state = mkdtempSync(join(tmpdir(), 'xopc-follow-recovery-'));
if (existsSync(join(sourceState, 'cache/model-catalog'))) cpSync(join(sourceState, 'cache/model-catalog'), join(state, 'cache/model-catalog'), { recursive: true });
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: configPath, XOPC_CREDENTIALS_DIR: credentials,
  XOPC_LOG_DIR: join(state, 'logs'), XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_CONSOLE: 'false' });
await import('../../../src/infra/http-proxy-env.js');
const { openXopcDatabase, closeXopcDatabase } = await import('../../../src/storage/sqlite/index.js');
const { resolveModel } = await import('../../../src/providers/index.js');
const { completeWithResolvedCredentials } = await import('../../../src/providers/model-call.js');
openXopcDatabase({ path: join(state, 'xopc.db') });
const model = resolveModel(manifest.judge);
let errors = 0;
try {
  for (const { row } of eligible) {
    const result: any = { caseId: row.caseId, originalError: row.error, judge: manifest.judge, candidateRegenerated: false, judgePrompt: row.judgePrompt };
    try {
      const response = await completeWithResolvedCredentials(model,
        { messages: [{ role: 'user', content: row.judgePrompt, timestamp: Date.now() }] },
        { reasoning: 'low', temperature: 0, maxTokens: 4096, signal: AbortSignal.timeout(240_000) }, undefined,
        { operation: 'personal_style_judge_recovery', trigger: 'user' });
      result.usage = response.usage; result.costUsd = model.provider === 'xopc-cloud' ? null : response.usage.cost.total;
      result.judgeResponse = response.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      if (response.errorMessage || ['error', 'aborted'].includes(response.stopReason)) throw new Error(response.errorMessage ?? response.stopReason);
      result.verdicts = JSON.parse(execFileSync('python3', ['-c', 'import json,sys; from protocol import parse_verdicts; print(json.dumps(parse_verdicts(sys.stdin.read(),int(sys.argv[1]))))', String(row.level)],
        { cwd: resolve('evals/personal/style'), input: result.judgeResponse, encoding: 'utf8' }));
      result.hardSatisfied = result.verdicts.every((v: string) => v === 'YES');
      result.softScore = result.verdicts.filter((v: string) => v === 'YES').length / row.level;
    } catch (error) { result.error = error instanceof Error ? error.message : String(error); errors++; }
    writeFileSync(join(out, `${row.caseId}.json`), JSON.stringify(result, null, 2));
    console.log(`${row.caseId}: ${result.error ? 'ERROR' : JSON.stringify(result.verdicts)}`);
  }
} finally { closeXopcDatabase(); rmSync(state, { recursive: true, force: true }); }
writeFileSync(join(out, 'completion.json'), JSON.stringify({ expected: eligible.length, attempted: eligible.length, errors, complete: errors === 0, costUsd: null }, null, 2));
process.exit(errors ? 1 : 0);
