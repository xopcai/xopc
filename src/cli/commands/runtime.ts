import { Command } from 'commander';

import { loadConfig } from '../../config/loader.js';
import { resolveStateDir } from '../../config/paths-state.js';
import { ManagedRuntimeManager } from '../../runtime-tools/manager.js';
import type { RuntimeKind } from '../../runtime-tools/types.js';
import { pruneRuntimeTools } from '../../runtime-tools/prune.js';
import { formatExamples, register, type CLIContext } from '../registry.js';

const RUNTIMES = ['node', 'uv', 'python'] as const;

function parseRuntime(value: string): RuntimeKind {
  if ((RUNTIMES as readonly string[]).includes(value)) return value as RuntimeKind;
  throw new Error(`Unknown runtime "${value}". Expected node, uv, or python.`);
}

function manager(ctx: CLIContext): ManagedRuntimeManager {
  const config = loadConfig(ctx.configPath);
  return new ManagedRuntimeManager({ stateDir: resolveStateDir(), config: config.runtimeTools });
}

function printStatuses(statuses: Awaited<ReturnType<ManagedRuntimeManager['statusAll']>>): void {
  for (const status of statuses) {
    const path = status.resolved?.executable ? ` — ${status.resolved.executable}` : '';
    console.log(`${status.runtime.padEnd(6)} ${status.state.padEnd(10)} ${status.message}${path}`);
  }
}

function createRuntimeCommand(ctx: CLIContext): Command {
  const command = new Command('runtime')
    .description('Manage Node.js and Python tool runtimes used by agents')
    .addHelpText('after', formatExamples([
      'xopc runtime status',
      'xopc runtime install node',
      'xopc runtime install python --version 3.12',
      'xopc runtime repair python',
      'xopc runtime prune',
    ]));

  command.command('status')
    .description('Show managed tool runtime status')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const statuses = await manager(ctx).statusAll();
      if (options.json) console.log(JSON.stringify(statuses, null, 2));
      else printStatuses(statuses);
      if (statuses.some((status) => status.state === 'corrupted' || status.state === 'failed')) {
        process.exitCode = 1;
      }
    });

  command.command('install')
    .description('Install one managed runtime')
    .argument('<runtime>', 'node, uv, or python')
    .option('--version <version>', 'Requested runtime version')
    .action(async (runtimeValue: string, options: { version?: string }) => {
      const runtime = parseRuntime(runtimeValue);
      const resolved = await manager(ctx).install(runtime, options.version);
      console.log(`${runtime} ${resolved.version} installed at ${resolved.executable}`);
    });

  command.command('repair')
    .description('Reinstall one invalid managed runtime')
    .argument('<runtime>', 'node, uv, or python')
    .action(async (runtimeValue: string) => {
      const runtime = parseRuntime(runtimeValue);
      const resolved = await manager(ctx).repair(runtime);
      console.log(`${runtime} ${resolved.version} repaired at ${resolved.executable}`);
    });

  command.command('prune')
    .description('Remove inactive runtime versions and stale cached artifacts')
    .action(async () => {
      const config = loadConfig(ctx.configPath);
      const result = await pruneRuntimeTools({
        stateDir: resolveStateDir(),
        config: config.runtimeTools,
      });
      console.log(`Removed ${result.removed.length} item(s), reclaimed ${result.reclaimedBytes} bytes`);
    });

  return command;
}

register({
  id: 'runtime',
  name: 'runtime',
  description: 'Manage agent tool runtimes',
  factory: createRuntimeCommand,
  metadata: {
    category: 'maintenance',
    examples: ['xopc runtime status', 'xopc runtime install python'],
  },
});
