import { Command } from 'commander';

import { register, formatExamples, type CLIContext } from '../registry.js';

function createTuiCommand(_ctx: CLIContext): Command {
  const cmd = new Command('tui')
    .description('Interactive terminal UI (pi-tui)')
    .addHelpText(
      'after',
      formatExamples([
        'xopc tui                                    # Connect to local gateway (default)',
        'xopc tui --local                            # Embedded mode, no gateway needed',
        'xopc tui --url http://host:3120 --token xxx # Connect to remote gateway',
        'xopc tui -s telegram:dm:123456              # Resume a session',
        'xopc tui -m "Summarize my inbox"            # Send a message on launch',
      ]),
    )
    .option('--url <url>', 'Gateway URL (default: http://localhost:3120)')
    .option('--token <token>', 'Gateway bearer token')
    .option('-s, --session <key>', 'Session key to resume')
    .option('-m, --message <text>', 'Send a message on launch')
    .option('--local', 'Run in embedded mode (no gateway required)')
    .option('--thinking <level>', 'Thinking level override')
    .action(async (options: Record<string, string | boolean | undefined>) => {
      const { runTui } = await import('../../tui/tui.js');
      await runTui({
        url: typeof options.url === 'string' ? options.url : undefined,
        token: typeof options.token === 'string' ? options.token : undefined,
        session: typeof options.session === 'string' ? options.session : undefined,
        message: typeof options.message === 'string' ? options.message : undefined,
        local: options.local === true,
        thinking: typeof options.thinking === 'string' ? options.thinking : undefined,
      });
    });

  return cmd;
}

register({
  id: 'tui',
  name: 'tui',
  description: 'Interactive terminal UI (pi-tui)',
  factory: createTuiCommand,
  metadata: {
    category: 'runtime',
    examples: [
      'xopc tui',
      'xopc tui --local',
      'xopc tui --url http://host:3120',
    ],
  },
});
