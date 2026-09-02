import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Command } from 'commander';

import { resolveStateDir } from '../../config/paths-state.js';
import { collectSupportReport } from '../../support/collect-support-report.js';
import { SupportReportInputSchema } from '../../support/types.js';
import { formatExamples, register, type CLIContext } from '../registry.js';

type ReportOptions = {
  output?: string;
  problem?: string;
};

function defaultOutputPath(capturedAt: string): string {
  const stamp = capturedAt.replace(/[:.]/g, '-');
  return resolve(`xopc-diagnostics-${stamp}.json`);
}

async function runSupportReport(ctx: CLIContext, options: ReportOptions): Promise<void> {
  const input = SupportReportInputSchema.parse({
    problem: options.problem ?? 'xopc startup or runtime problem',
    occurredAt: new Date().toISOString(),
  });
  const report = await collectSupportReport(input, {
    paths: {
      configPath: ctx.configPath,
      stateDir: resolveStateDir(),
      workspaceDir: ctx.workspacePath,
    },
  });
  const outputPath = options.output ? resolve(options.output) : defaultOutputPath(report.capturedAt);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });

  console.log(report.markdown);
  console.log(`\nDiagnostic file: ${outputPath}`);
}

function createSupportCommand(ctx: CLIContext): Command {
  const command = new Command('support')
    .description('Create a redacted diagnostic report for an xopc problem')
    .addHelpText('after', formatExamples([
      'xopc support report',
      'xopc support report --problem "Telegram receives messages but does not reply"',
      'xopc support report --output ./xopc-diagnostics.json',
    ]));

  command
    .command('report')
    .description('Collect Doctor results and nearby warning/error logs')
    .option('-p, --problem <text>', 'Short description of the problem')
    .option('-o, --output <path>', 'Diagnostic JSON output path (must not already exist)')
    .action((options: ReportOptions) => runSupportReport(ctx, options));

  return command;
}

register({
  id: 'support',
  name: 'support',
  description: 'Create a redacted diagnostic report for an xopc problem',
  factory: createSupportCommand,
  metadata: {
    category: 'maintenance',
    examples: ['xopc support report'],
  },
});
