import { Command } from 'commander';

import { exportCtxHistory } from '../../history/ctx/exporter.js';
import { requireXopcDatabase } from '../../storage/sqlite/index.js';
import { formatExamples, register, type CLIContext } from '../registry.js';

interface ExportCtxOptions {
  outputDir?: string;
  json?: boolean;
}

async function runCtxExport(options: ExportCtxOptions): Promise<void> {
  try {
    const { db } = requireXopcDatabase();
    const result = await exportCtxHistory(db, { outputDir: options.outputDir });
    const importCommand = `ctx import --history-source-manifest ${result.manifestPath}`;
    if (options.json) {
      console.log(JSON.stringify({ ...result, importCommand }, null, 2));
      return;
    }

    const action = result.changed ? 'Exported' : 'Already up to date';
    console.log(`${action}: ${result.sessionCount} sessions, ${result.eventCount} events`);
    console.log(`History: ${result.historyPath}`);
    console.log(`Manifest: ${result.manifestPath}`);
    console.log(`\nRegister or refresh it in ctx:\n  ${importCommand}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to export history for ctx: ${message}`);
    process.exit(1);
  }
}

function createHistoryCommand(_ctx: CLIContext): Command {
  const command = new Command('history')
    .description('Export XOPC session history for external tools')
    .addHelpText('after', formatExamples([
      'xopc history export ctx',
      'xopc history export ctx --output-dir ./xopc-ctx-history',
      'xopc history export ctx --json',
    ]));
  const exportCommand = command
    .command('export')
    .description('Export session history');
  exportCommand
    .command('ctx')
    .description('Export a provider-owned ctx-history-jsonl-v2 source')
    .option('--output-dir <path>', 'Output directory (default: <xopc-state>/exports/ctx)')
    .option('--json', 'Output the result as JSON')
    .action(runCtxExport);
  return command;
}

register({
  id: 'history',
  name: 'history',
  description: 'Export XOPC session history for external tools',
  factory: createHistoryCommand,
  metadata: {
    category: 'utility',
    examples: ['xopc history export ctx'],
  },
});
