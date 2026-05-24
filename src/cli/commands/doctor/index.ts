import { Command } from 'commander';
import { register, formatExamples, type CLIContext } from '../../registry.js';
import { resolveStateDir } from '../../../config/paths-state.js';
import { runDoctor } from './flow.js';
import type { DoctorOptions } from './types.js';

function createDoctorCommand(ctx: CLIContext): Command {
  return new Command('doctor')
    .description('Check xopc installation health and diagnose common issues')
    .option('--fix', 'Automatically apply safe fixes', false)
    .option('--json', 'Output results as JSON', false)
    .option('--deep', 'Run deeper / slower checks (e.g. session scan)', false)
    .option('--security', 'Run gateway security audit only (structured findings)', false)
    .addHelpText(
      'after',
      formatExamples([
        'xopc doctor',
        'xopc doctor --json',
        'xopc doctor --deep',
        'xopc doctor --security',
        'xopc doctor --fix',
      ]),
    )
    .action(async (opts: DoctorOptions) => {
      const configPath = ctx.configPath;
      const stateDir = resolveStateDir();
      const results = await runDoctor({
        configPath,
        stateDir,
        options: {
          fix: Boolean(opts.fix),
          json: Boolean(opts.json),
          deep: Boolean(opts.deep),
          security: Boolean(opts.security),
        },
      });
      const failed = results.some((r) => r.status === 'fail');
      if (failed) {
        process.exitCode = 1;
      }
    });
}

register({
  id: 'doctor',
  name: 'doctor',
  description: 'Check xopc installation health and diagnose common issues',
  factory: createDoctorCommand,
  metadata: {
    category: 'maintenance',
    examples: [
      'xopc doctor',
      'xopc doctor --json',
      'xopc doctor --deep',
      'xopc doctor --security',
      'xopc doctor --fix',
    ],
  },
});
