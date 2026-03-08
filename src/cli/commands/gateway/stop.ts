import { Command } from 'commander';
import { loadConfig, DEFAULT_PATHS } from '../../../config/index.js';
import { createLogger } from '../../../utils/logger.js';
import { getContextWithOpts } from '../../index.js';
import { acquireGatewayLock } from '../../../gateway/lock.js';
import { forceFreePortAndWait, listPortListeners } from '../../../gateway/ports.js';

const _log = createLogger('GatewayStopCommand');

/**
 * Create stop subcommand
 */
export function createStopCommand(): Command {
  return new Command('stop')
    .description('Stop running gateway')
    .option('--force', 'Force kill immediately', false)
    .option('--timeout <ms>', 'Timeout before force kill', '5000')
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const config = loadConfig(ctx.configPath);
      const port = config?.gateway?.port || 18790;

      // Check if gateway is running by trying to acquire lock
      try {
        const lock = await acquireGatewayLock(ctx.configPath || DEFAULT_PATHS.config, {
          timeoutMs: 100,
          port,
        });
        await lock.release();
        console.log('ℹ️  Gateway is not running');
        process.exit(0);
      } catch {
        // Lock exists, gateway is running
      }

      console.log('🛑 Stopping gateway...');

      try {
        const listeners = listPortListeners(port);
        if (listeners.length === 0) {
          console.log('ℹ️  No process found listening on port');
          process.exit(0);
        }

        const timeout = parseInt(options.timeout, 10);

        if (options.force) {
          // Force kill immediately
          for (const proc of listeners) {
            try {
              process.kill(proc.pid, 'SIGKILL');
              console.log(`   Killed pid ${proc.pid}`);
            } catch (err) {
              console.warn(`   Failed to kill pid ${proc.pid}: ${String(err)}`);
            }
          }
        } else {
          // Graceful shutdown
          const result = await forceFreePortAndWait(port, {
            timeoutMs: timeout,
            sigtermTimeoutMs: Math.min(2000, timeout / 2),
          });

          if (result.killed.length > 0) {
            for (const proc of result.killed) {
              console.log(`   Stopped pid ${proc.pid}`);
            }
            if (result.escalatedToSigkill) {
              console.log('   Escalated to SIGKILL');
            }
          }
        }

        console.log('✅ Gateway stopped');
        process.exit(0);
      } catch (err) {
        console.error('❌ Failed to stop gateway:', err);
        process.exit(1);
      }
    });
}
