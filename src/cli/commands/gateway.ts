import { Command } from 'commander';

import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../context.js';
import { runGatewayFromCliOptions } from './gateway/run-foreground.js';
import { prepareGatewayCommandForArgv } from './gateway/subcommands.js';

function createGatewayCommand(_ctx: CLIContext): Command {
  const cmd = new Command('gateway')
    .description('Start the xopc gateway server')
    .addHelpText(
      'after',
      formatExamples([
        'xopc gateway                   # Start gateway (foreground)',
        'xopc gateway service install   # Install OS service (background)',
        'xopc gateway --bind lan          # Listen on all interfaces (LAN)',
        'xopc gateway --port 8080       # Custom port',
        'xopc gateway --force           # Force kill existing process',
        'xopc gateway stop             # Stop gateway',
        'xopc gateway restart          # Restart gateway',
        'xopc gateway status           # Check gateway status',
        'xopc gateway health           # Check gateway health',
        'xopc gateway call status      # Call gateway API (alias)',
        'xopc gateway probe            # Probe reachability / auth',
        'xopc gateway logs             # View recent logs',
        'xopc gateway token            # Show current token',
        'xopc gateway token --generate # Generate new token',
      ]),
    )
    .option(
      '--bind <mode>',
      'Bind mode: loopback | lan | auto | custom | tailnet',
    )
    .option('--port <number>', 'Port to listen on (defaults to gateway.port in config, else 18790)')
    .option('--token <token>', 'Authentication token')
    .option('--tailscale <mode>', 'Tailscale exposure: off | serve | funnel (overrides config for this run)')
    .option('--tailscale-reset-on-exit', 'Reset Tailscale serve/funnel on gateway shutdown', false)
    .option('--force', 'Force kill existing process on port', false)
    .option('--no-hot-reload', 'Disable config hot reload')
    .option('--foreground', 'Start gateway in foreground mode (blocks terminal)', true)
    .action(async (options) => {
      const ctx = getContextWithOpts();
      await runGatewayFromCliOptions(options, ctx);
    });

  return cmd;
}

register({
  id: 'gateway',
  name: 'gateway',
  description: 'Start the xopc gateway server',
  factory: createGatewayCommand,
  metadata: {
    category: 'runtime',
    examples: [
      'xopc gateway',
      'xopc gateway service install',
      'xopc gateway --port 8080',
    ],
  },
});

export { createGatewayCommand, prepareGatewayCommandForArgv };
