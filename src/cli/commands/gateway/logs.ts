import { Command } from 'commander';
import { createLogger } from '../../../utils/logger.js';
import { getContextWithOpts } from '../../index.js';
import { spawn, execSync } from 'child_process';

const _log = createLogger('GatewayLogsCommand');

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
      
      // Determine log directory from environment or default
      const logDir = process.env.XOPCBOT_LOG_DIR || 
        `${ctx.configPath.replace('/config.json', '')}/logs`;

      try {
        if (options.follow) {
          // Follow mode: use tail -f
          console.log(`📜 Following gateway logs (Ctrl+C to exit)...\n`);
          const tail = spawn('tail', ['-f', '-n', options.lines, `${logDir}/app.log`], {
            stdio: 'inherit',
          });
          
          tail.on('error', (err) => {
            console.error('❌ Failed to tail logs:', err.message);
            process.exit(1);
          });
        } else {
          // Static mode: read last N lines
          const output = execSync(
            `tail -n ${options.lines} ${logDir}/app.log 2>/dev/null || echo "No logs found"`,
            { encoding: 'utf-8' }
          );
          
          console.log(`📜 Last ${options.lines} lines of gateway logs:\n`);
          console.log(output);
          process.exit(0);
        }
      } catch (err) {
        console.error('❌ Failed to read logs:', err);
        process.exit(1);
      }
    });
}
