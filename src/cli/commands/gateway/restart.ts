import { Command } from 'commander';

/**
 * Create restart subcommand - delegates to daemon lifecycle core
 */
export function createRestartCommand(): Command {
  return new Command('restart')
    .description('Restart the gateway service')
    .option('--force', 'Force restart (kill if needed)')
    .option('--wait <timeout>', 'Wait for health after restart (e.g. "30s", "1m")')
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const { executeDaemonRestart } = await import('./lifecycle-core.js');
      await executeDaemonRestart(options);
    });
}
