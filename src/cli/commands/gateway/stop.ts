import { Command } from 'commander';

/**
 * Create stop subcommand - delegates to daemon lifecycle core
 */
export function createStopCommand(): Command {
  return new Command('stop')
    .description('Stop the gateway service')
    .option('--disable', 'Disable KeepAlive so gateway does not respawn')
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const { runDaemonStop } = await import('./lifecycle.js');
      await runDaemonStop(options);
    });
}
