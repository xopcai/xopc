/** Explicit real-app acceptance against the checksum-verified local candidate. */
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const repo = resolve(import.meta.dirname, '..');
const output = join(repo, '.cache/computer-calculator-live', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
await build({ entryPoints: [join(repo, 'scripts/verify-computer-calculator-native.mts')], outfile: join(output, 'verify.mjs'),
  bundle: true, platform: 'node', format: 'esm', external: ['electron', '@trycua/cua-driver'],
  banner: { js: 'import { createRequire as __benchmarkRequire } from "node:module"; const require = __benchmarkRequire(import.meta.url);' } });
const env = { ...process.env, XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_FILE: 'false' };
delete env.ELECTRON_RUN_AS_NODE;
const electron = createRequire(import.meta.url)('electron') as string;
const child = spawn(electron, [join(output, 'verify.mjs'), repo, output], { env, stdio: 'inherit', timeout: 120_000 });
const code = await new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); });
console.log(JSON.stringify({ evidence: output, report: JSON.parse(await readFile(join(output, 'report.json'), 'utf8')) }, null, 2));
process.exitCode = code ?? 1;
