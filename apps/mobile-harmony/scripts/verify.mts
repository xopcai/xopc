import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const toolsDir = process.env.HARMONY_TOOLS_DIR;
const binary = (name: string): string => toolsDir ? join(toolsDir, 'bin', name) : name;
function run(command: string, args: string[], cwd = repo): void {
  console.log(`\nChecking: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, XOPC_LOG_LEVEL: 'fatal' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}
run('pnpm', ['exec', 'tsx', join(project, 'scripts/export-contracts.mts'), '--check']);
run('pnpm', ['exec', 'vitest', 'run', '--config', join(project, 'vitest.config.ts'), '--root', project]);
run('pnpm', ['exec', 'vitest', 'run',
  'src/storage/sqlite/migrations/__tests__/harmonyos-devices.test.ts',
  'src/storage/sqlite/__tests__/migrations.test.ts',
  'src/storage/sqlite/__tests__/device-pairing-approval.test.ts',
  'src/gateway/hono/routes/__tests__/device-pairing-routes.test.ts',
  'src/gateway/hono/routes/__tests__/device-push-routes.test.ts',
  'src/gateway/hono/routes/__tests__/notes-routes.test.ts',
  'src/notifications/__tests__/harmony-push.test.ts',
  'src/notifications/__tests__/service.test.ts',
  'src/notifications/__tests__/store.test.ts']);
run('pnpm', ['run', 'typecheck']);
if (process.argv.includes('--host-only')) process.exit(0);
if (!existsSync(join(project, 'oh_modules'))) throw new Error('Run ohpm install in apps/mobile-harmony first.');
for (const mode of ['debug', 'release']) {
  run(binary('hvigorw'), ['assembleHap', '--mode', 'module', '-p', 'module=entry@default', '-p', 'product=default',
    '-p', `buildMode=${mode}`, '--no-daemon'], project);
}
mkdirSync(join(project, '.test'), { recursive: true });
const lintReport = join(project, '.test/code-linter.json');
run(binary('codelinter'), ['-c', join(project, 'code-linter.json5'), '-f', 'json', '-e', 'error,warn', '-o', lintReport, project], project);
const report = JSON.parse(readFileSync(lintReport, 'utf8')) as { messages?: { severity: string }[] }[];
const diagnostics = report.flatMap((file) => file.messages ?? []);
if (diagnostics.length) throw new Error(`CodeLinter returned ${diagnostics.length} diagnostics; inspect ${lintReport}`);
console.log('Host checks, debug/release unsigned HAP builds and CodeLinter passed. Device acceptance is a separate gate.');
