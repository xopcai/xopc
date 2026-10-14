import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1] ?? fallback;
};
const root = resolve(option('--root', sourceRoot));
const suite = option('--suite', 'p0');
if (!['p0', 'p1', 'p2'].includes(suite)) throw new Error('Expected --suite p0, p1 or p2');
const output = resolve(option('--output', join(sourceRoot, `.xopc-evals/personal/${suite}-current.json`)));
const label = option('--label', 'candidate');
const testFile = 'src/tasks/__tests__/personal-delivery-benchmark.test.ts';
const testFiles = suite !== 'p0' ? [testFile, 'src/tasks/__tests__/task-research-result.test.ts', ...(suite === 'p2' ? ['src/tasks/__tests__/task-research-repair.test.ts', 'src/tasks/__tests__/task-research-review-format.test.ts', 'src/tasks/__tests__/task-model-call.test.ts', 'src/agent/tools/__tests__/web-fetch-content.test.ts'] : [])] : [testFile];
const directory = mkdtempSync(join(tmpdir(), 'xopc-personal-benchmark-'));
const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const git = (command: string[]) => spawnSync('git', command, { cwd: root, encoding: 'utf8' }).stdout?.trim();
const sources = [...testFiles, 'pnpm-lock.yaml', 'src/agent/tools/personal-task-tool.ts',
  'src/tasks/task-result-delivery-repository.ts', 'src/tasks/task-result-delivery-service.ts',
  'src/personal-agent/reply-composer.ts', 'src/personal-agent/reply-style.ts', 'src/personal-agent/prompts.ts',
  'src/personal-agent/repository.ts', 'src/agent/prompt/sections/messaging-runtime.ts',
  'src/personal-agent/result-file-links.ts', ...(suite !== 'p0' ? ['src/tasks/task-research-result.ts',
    'src/tasks/task-run-coordinator.ts', 'src/tasks/task-allocation-service.ts', 'src/tasks/task-contract-planner.ts',
    'src/agent/tools/task-result-tool.ts', 'src/agent/tools/factory.ts', 'packages/gateway-contract/src/task-research-result.ts',
    'packages/gateway-contract/src/turn-outcome.ts', ...(suite === 'p2' ? ['src/tasks/task-research-repair.ts', 'src/tasks/task-model-call.ts', 'src/session/store.ts', 'src/config/schema.ts', 'src/tasks/task-run-repository.ts', 'src/agent/tasks/task-judge-service.ts', 'src/tasks/task-continuation.ts', 'src/agent/orchestration/turn-recovery.ts', 'src/agent/embedded/run-for-session.ts', 'src/agent/embedded/run-turn.ts', 'src/agent/embedded/types.ts', 'src/agent/tools/web.ts'] : [])] : [])];
const fingerprints = () => Object.fromEntries(sources.map(path => {
  try { return [path, hash(readFileSync(join(root, path)))]; } catch { return [path, null]; }
}));
const initialHashes = fingerprints();
try {
  const rawPath = join(directory, 'vitest.json');
  const result = spawnSync(process.execPath, [join(sourceRoot, 'node_modules/vitest/vitest.mjs'), 'run', ...testFiles,
    '--reporter=json', `--outputFile=${rawPath}`], { cwd: root, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, XOPC_LOG_LEVEL: 'fatal' }, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  const cases = raw.testResults.flatMap((file: { assertionResults: Array<{ title: string; status: string; duration?: number; failureMessages: string[] }> }) =>
    file.assertionResults.map(item => ({ id: item.title.split(':')[0], name: item.title,
      status: item.status, durationMs: item.duration ?? null,
      failures: item.failureMessages.map(message => message.replaceAll(root, '<source-root>')) })));
  if (cases.length !== (suite === 'p2' ? 48 : suite === 'p1' ? 20 : 8) || cases.some(item => !['passed', 'failed'].includes(item.status))) {
    throw new Error('Expected every benchmark case to execute');
  }
  const report = { schemaVersion: 1, suite: `personal-delivery-${suite}`, suiteVersion: suite === 'p2' ? 2 : 1,
    mode: 'deterministic', label, createdAt: new Date().toISOString(),
    manifest: { commit: git(['rev-parse', 'HEAD']), nodeVersion: process.version,
      workingTreeDirty: Boolean(git(['status', '--porcelain'])),
      hashes: initialHashes, sourceChangedDuringRun: JSON.stringify(initialHashes) !== JSON.stringify(fingerprints()),
      models: 'No model calls; scripted component/reviewer fixtures. H03 checks policy, not naturalness.' },
    total: cases.length, passed: cases.filter(item => item.status === 'passed').length,
    durationMs: Date.now() - raw.startTime, cases };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, suite: report.suite, label, passed: report.passed, total: report.total }));
  process.exitCode = report.passed === report.total && !report.manifest.sourceChangedDuringRun ? 0 : 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
