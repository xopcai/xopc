import { Command } from 'commander';
import crypto from 'crypto';
import { resolveConfigPath } from '../../../config/paths.js';
import { getContextWithOpts } from '../../index.js';

/**
 * Create the token subcommand for managing gateway authentication token.
 */
export function createTokenCommand(): Command {
  return new Command('token')
    .description('Manage gateway authentication token')
    .option('--generate', 'Generate a new token and save to config')
    .option('--mode <mode>', 'Auth mode: token or none', 'token')
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const configPath = ctx.configPath || resolveConfigPath();
      const [{ loadConfig, saveConfig }, { createLogger }] = await Promise.all([
        import('../../../config/index.js'),
        import('../../../utils/logger.js'),
      ]);
      const log = createLogger('GatewayTokenCommand');

      try {
        const config = loadConfig(configPath);

        if (options.generate) {
          const newToken = crypto.randomBytes(24).toString('hex');

          config.gateway = config.gateway || {};
          config.gateway.auth = {
            mode: 'token',
            token: newToken,
          };

          await saveConfig(config, configPath);

          console.log('✅ Generated new gateway token:');
          console.log('');
          console.log(`   ${newToken}`);
          console.log('');
          console.log('📝 Saved to config file. Use this token in the X-Api-Key header or as:');
          console.log(`   xopc gateway --token ${newToken}`);
          console.log('');
          console.log('Or set environment variable:');
          console.log(`   export XOPC_GATEWAY_TOKEN=${newToken}`);
          process.exit(0);
        } else {
          const currentToken = config.gateway?.auth?.token;
          const mode = config.gateway?.auth?.mode || 'token';

          if (mode === 'none') {
            console.log('⚠️  Gateway authentication is disabled (mode: none)');
            console.log('');
            console.log('To enable authentication, run:');
            console.log('   xopc gateway token --generate');
          } else if (currentToken) {
            const tokenPreview = `${currentToken.slice(0, 8)}...${currentToken.slice(-8)}`;
            console.log('🔑 Current gateway token:');
            console.log('');
            console.log(`   ${currentToken}`);
            console.log('');
            console.log(`Preview: ${tokenPreview}`);
            console.log('');
            console.log('Usage:');
            console.log(`   xopc gateway --token ${currentToken}`);
            console.log('');
            console.log('Or set environment variable:');
            console.log(`   export XOPC_GATEWAY_TOKEN=${currentToken}`);
          } else {
            console.log('⚠️  No token configured. A token will be auto-generated on startup.');
            console.log('');
            console.log('To set a persistent token, run:');
            console.log('   xopc gateway token --generate');
          }
          process.exit(0);
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to manage token');
        process.exit(1);
      }
    });
}
