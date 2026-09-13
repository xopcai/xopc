import { Command } from 'commander';
import crypto from 'crypto';
import { resolveConfigPath } from '../../../config/paths.js';
import { getContextWithOpts } from '../../context.js';

async function readInstalledServiceToken(): Promise<string | undefined> {
  try {
    const { isDaemonAvailableAsync, resolveGatewayService } = await import('../../../daemon/service.js');
    if (!(await isDaemonAvailableAsync())) return undefined;
    const service = await resolveGatewayService();
    if (!(await service.isLoaded({ env: process.env }))) return undefined;
    const command = await service.readCommand(process.env);
    return command?.environment?.XOPC_GATEWAY_TOKEN?.trim() || undefined;
  } catch {
    return undefined;
  }
}

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
        const installedServiceToken = await readInstalledServiceToken();

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
          if (installedServiceToken && installedServiceToken !== newToken) {
            console.log('');
            console.log('⚠️  The installed gateway service still uses its previous token.');
            console.log('   Run `xopc gateway service install --force`, then restart the service.');
          }
          process.exit(0);
        } else {
          const configToken = config.gateway?.auth?.token?.trim();
          const environmentToken = process.env.XOPC_GATEWAY_TOKEN?.trim();
          const currentToken = installedServiceToken || environmentToken || configToken;
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
            if (installedServiceToken) {
              console.log('Source: installed gateway service');
            } else if (environmentToken) {
              console.log('Source: XOPC_GATEWAY_TOKEN');
            } else {
              console.log(`Source: ${configPath}`);
            }
            if (installedServiceToken && configToken && installedServiceToken !== configToken) {
              console.log('');
              console.log('⚠️  Token drift detected: the installed service token overrides the config token.');
              console.log('   Run `xopc gateway service install --force`, then restart the service to sync.');
            }
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
