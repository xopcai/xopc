import type { Command } from 'commander';

import { ROOT_COMMAND_DESCRIPTION } from './command-manifest.js';
import { createDefaultContext, type CLIContext } from './registry.js';
import { isGatewayRunFastPathArgv } from './gateway-run-argv.js';
import pkg from '../../package.json' with { type: 'json' };

let parsedOpts: { config?: string; workspace?: string; verbose?: boolean } = {};

function getContextWithOpts(argv: string[] = process.argv): CLIContext {
  return createDefaultContext(argv, parsedOpts);
}

function buildGatewayRunOptions(cmd: Command) {
  return cmd
    .description('Start the xopc gateway server')
    .option('--bind <mode>', 'Bind mode: loopback | lan | auto | custom | tailnet')
    .option('--port <number>', 'Port to listen on (defaults to gateway.port in config, else 18790)')
    .option('--token <token>', 'Authentication token')
    .option(
      '--tailscale <mode>',
      'Tailscale exposure: off | serve | funnel (overrides config for this run)',
    )
    .option('--tailscale-reset-on-exit', 'Reset Tailscale serve/funnel on gateway shutdown', false)
    .option('--force', 'Force kill existing process on port', false)
    .option('--no-hot-reload', 'Disable config hot reload')
    .option('--foreground', 'Start gateway in foreground mode (blocks terminal)', true)
    .option('--background', 'Start gateway in background mode (detached)', false);
}

export async function tryRunGatewayRunFastPath(argv: string[] = process.argv): Promise<boolean> {
  if (!isGatewayRunFastPathArgv(argv)) {
    return false;
  }

  const { Command } = await import('commander');
  const { runGatewayFromCliOptions } = await import('./commands/gateway/run-foreground.js');

  const program = new Command()
    .name('xopc')
    .description(ROOT_COMMAND_DESCRIPTION)
    .version(pkg.version)
    .option('--verbose', 'Enable verbose logging', false)
    .option('--config <path>', 'Config file path')
    .option('--workspace <path>', 'Workspace directory');

  program.hook('preAction', (thisCommand) => {
    parsedOpts = thisCommand.opts();
  });

  const gateway = buildGatewayRunOptions(new Command('gateway'));
  gateway.action(async (options) => {
    await runGatewayFromCliOptions(options, getContextWithOpts(argv));
  });
  program.addCommand(gateway);

  await program.parseAsync(argv);

  const { flushAndClose } = await import('../utils/logger/shutdown.js');
  await flushAndClose();
  return true;
}
