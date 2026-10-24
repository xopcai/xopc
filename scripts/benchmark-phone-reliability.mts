import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { PhoneRuntime } from '../src/phone/runtime.js';
import { runReliabilitySuite } from './phone-reliability/tasks.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const baselineRef = option('--baseline') ?? 'HEAD';
const repeats = Number(option('--repeats') ?? 3);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20) throw new Error('--repeats must be an integer from 1 to 20');
const baselineCommit = execFileSync('git', ['rev-parse', '--verify', `${baselineRef}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const source = execFileSync('git', ['show', `${baselineCommit}:src/phone/runtime.ts`], { cwd: root, encoding: 'utf8' });
// Snapshot only the old orchestrator. Shared configuration, repository and driver
// types stay current, so this comparison does not measure model or input changes.
const rebased = source.replace(/(from\s*['"])(\.{1,2}\/[^'"]+)(['"])/g, (_match, prefix: string, specifier: string, suffix: string) => {
  const path = resolve(root, 'src/phone', specifier);
  const typescript = path.replace(/\.js$/, '.ts');
  return `${prefix}${pathToFileURL(existsSync(typescript) ? typescript : path).href}${suffix}`;
});
const temporary = await mkdtemp(join(tmpdir(), 'xopc-phone-reliability-'));
try {
  const path = join(temporary, 'baseline-runtime.mts');
  await writeFile(path, rebased);
  const Baseline = (await import(pathToFileURL(path).href)).PhoneRuntime as typeof PhoneRuntime;
  const baseline = await runReliabilitySuite(Baseline, repeats);
  const optimized = await runReliabilitySuite(undefined, repeats);
  const result = { generatedAt: new Date().toISOString(), baselineCommit, repeats,
    scope: 'Synthetic device tasks with scripted policy, production runtime; baseline snapshots runtime.ts only and uses current shared dependencies. Three clock-noise fixtures vary stage length and exercise one mechanism: inert system-clock text is ignored while application content changes remain blocking. Repeats check deterministic reproducibility, not statistical confidence. No real device or model calls. These results do not estimate real-world task completion rates.',
    baseline, optimized };
  const output = option('--output');
  if (output) await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
