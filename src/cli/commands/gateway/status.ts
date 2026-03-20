import { Command } from 'commander';
import { loadConfig } from '../../../config/index.js';
import { resolveConfigPath } from '../../../config/paths.js';
import { createLogger } from '../../../utils/logger.js';
import { getContextWithOpts } from '../../index.js';
import { acquireGatewayLock, GatewayLockError } from '../../../gateway/lock.js';

const _log = createLogger('GatewayStatusCommand');

/**
 * Create status subcommand
 */
export function createStatusCommand(): Command {
  return new Command('status')
    .description('Check gateway status')
    .action(async () => {
      const ctx = getContextWithOpts();
      const configPath = ctx.configPath || resolveConfigPath();
      const config = loadConfig(configPath);
      const port = config?.gateway?.port || 18790;

      try {
        // Try to acquire lock - if successful, gateway is not running
        const lock = await acquireGatewayLock(configPath, { timeoutMs: 100, port });
        await lock.release();
        console.log('⚠️  Gateway is not running');
        console.log('\n💡 Start with: xopcbot gateway');
        process.exit(0);
      } catch (err) {
        if (err instanceof GatewayLockError) {
          console.log('✅ Gateway is running');
          console.log(`   Port: ${port}`);

          // Try to get more info from lock file
          // This is a simplified version - could be enhanced
          console.log('');
          console.log('🌐 Access:');
          const host = 'localhost';
          console.log(`   URL: http://${host}:${port}`);

          const token = config?.gateway?.auth?.token;
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }

          console.log('');
          console.log('📝 Management:');
          console.log('   xopcbot gateway stop      # Stop gateway');
          console.log('   xopcbot gateway restart   # Restart gateway');
          process.exit(0);
        } else {
          console.error('❌ Failed to check status:', err);
          process.exit(1);
        }
      }
    });
}
