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
        'xopc tui -s agent:main:tui-...              # Resume a session',
        'xopc tui -m "Summarize my inbox"            # Send a message on launch',
      ]),
    )
    .option('--url <url>', 'Gateway URL (default: http://localhost:3120)')
    .option('--token <token>', 'Gateway bearer token')
    .option('-s, --session <key>', 'Session key to resume (omitted: start a fresh TUI session)')
    .option('-m, --message <text>', 'Send a message on launch')
    .option('--workdir <dir>', 'Workspace directory for the new TUI session')
    .option('--no-cwd', 'Do not use the launch directory as the new TUI session workspace')
    .option('--local', 'Run in embedded mode (no gateway required)')
    .option('--theme <name>', 'Theme: auto, dark, light, or custom name from ~/.xopc/themes/')
    .option('--thinking <level>', 'Thinking level override')
    .action(async (options: Record<string, string | boolean | undefined>) => {
      const { runTui } = await import('../../tui/tui.js');
      await runTui({
        url: typeof options.url === 'string' ? options.url : undefined,
        token: typeof options.token === 'string' ? options.token : undefined,
        session: typeof options.session === 'string' ? options.session : undefined,
        message: typeof options.message === 'string' ? options.message : undefined,
        workdir: typeof options.workdir === 'string' ? options.workdir : undefined,
        useStartupCwd: options.cwd !== false,
        local: options.local === true,
        thinking: typeof options.thinking === 'string' ? options.thinking : undefined,
        theme: typeof options.theme === 'string' ? options.theme : undefined,
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
