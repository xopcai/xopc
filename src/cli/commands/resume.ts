import { Command } from 'commander';

import { register, formatExamples, type CLIContext } from '../registry.js';
import { prepareTuiStartup, runTuiFromCliOptions, type TuiCliOptions } from './tui-runner.js';

function createResumeCommand(ctx: CLIContext): Command {
  return new Command('resume')
    .description('Resume a previous TUI session')
    .argument('[sessionKey]', 'Session key to resume directly')
    .addHelpText(
      'after',
      formatExamples([
        'xopc resume                                  # Choose a session interactively',
        'xopc resume agent:main:tui-...               # Resume a specific session',
        'xopc resume --gateway --url http://host:3120 # Choose a remote session',
      ]),
    )
    .option('--url <url>', 'Gateway URL (default: http://localhost:3120)')
    .option('--token <token>', 'Gateway bearer token')
    .option('--password-env <name>', 'Environment variable holding the gateway password')
    .option('--workdir <dir>', 'Workspace directory for the resumed TUI session')
    .option('--no-cwd', 'Do not use the launch directory as the resumed TUI session workspace')
    .option('--local', 'Run in embedded mode (no gateway required)')
    .option('--gateway', 'Force gateway mode even without an explicit URL or credential')
    .option('--theme <name>', 'Theme: auto, dark, light, or custom name from ~/.xopc/themes/')
    .option('--thinking <level>', 'Thinking level override')
    .action(async (sessionKey: string | undefined, options: TuiCliOptions) => {
      prepareTuiStartup(ctx.configPath);
      await runTuiFromCliOptions(options, {
        session: sessionKey,
        openSessionPickerOnStart: sessionKey === undefined,
      });
    });
}

register({
  id: 'resume',
  name: 'resume',
  description: 'Resume a previous TUI session',
  factory: createResumeCommand,
  metadata: {
    category: 'runtime',
    examples: ['xopc resume', 'xopc resume agent:main:tui-...'],
  },
});
