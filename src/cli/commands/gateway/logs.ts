import { Command } from 'commander';
import { existsSync, statSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getContextWithOpts } from '../../context.js';

function parseLineCount(value: string | number | undefined): number {
  const parsed = parseInt(String(value ?? '50'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

function resolveGatewayLogPath(configPath: string): string {
  const logDir = process.env.XOPC_LOG_DIR || path.join(path.dirname(configPath), 'logs');
  return path.join(logDir, 'app.log');
}

async function readLastLines(filePath: string, lineCount: number): Promise<string> {
  if (!existsSync(filePath)) {
    return 'No logs found\n';
  }

  const content = await readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const trailingEmptyLine = lines.at(-1) === '';
  const logLines = trailingEmptyLine ? lines.slice(0, -1) : lines;
  const selectedLines = logLines.slice(-lineCount);
  return `${selectedLines.join('\n')}${selectedLines.length > 0 ? '\n' : ''}`;
}

async function followLogFile(filePath: string, lineCount: number): Promise<void> {
  process.stdout.write(await readLastLines(filePath, lineCount));
  let lastSize = existsSync(filePath) ? statSync(filePath).size : 0;

  const directory = path.dirname(filePath);
  const fileName = path.basename(filePath);
  watch(directory, async (_eventType, changedFileName) => {
    if (changedFileName && changedFileName.toString() !== fileName) {
      return;
    }
    if (!existsSync(filePath)) {
      lastSize = 0;
      return;
    }

    const nextSize = statSync(filePath).size;
    if (nextSize < lastSize) {
      lastSize = 0;
    }
    if (nextSize === lastSize) {
      return;
    }

    const content = await readFile(filePath, 'utf8');
    process.stdout.write(content.slice(lastSize));
    lastSize = nextSize;
  });
}

/**
 * Create logs subcommand
 */
export function createLogsCommand(): Command {
  return new Command('logs')
    .description('View gateway logs')
    .option('--lines <n>', 'Number of lines to show', '50')
    .option('--follow', 'Follow log output (like tail -f)')
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const lineCount = parseLineCount(options.lines);
      const logPath = resolveGatewayLogPath(ctx.configPath);

      try {
        if (options.follow) {
          console.log(`📜 Following gateway logs (Ctrl+C to exit)...\n`);
          await followLogFile(logPath, lineCount);
          return;
        }

        const output = await readLastLines(logPath, lineCount);
        console.log(`📜 Last ${lineCount} lines of gateway logs:\n`);
        console.log(output);
        process.exit(0);
      } catch (err) {
        console.error('❌ Failed to read logs:', err);
        process.exit(1);
      }
    });
}

export const gatewayLogsTestInternals = {
  parseLineCount,
  readLastLines,
  resolveGatewayLogPath,
};
