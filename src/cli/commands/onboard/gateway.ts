/**
 * Gateway Configuration and Startup for Onboarding
 */

import { confirm } from '@inquirer/prompts';
import type { Config } from '../../../config/schema.js';
import type { CLIContext } from '../../registry.js';
import { acquireGatewayLock, GatewayLockError } from '../../../gateway/lock.js';

function isInteractive(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

export async function setupGateway(config: Config): Promise<Config> {
  console.log('\n🌐 Step: Gateway WebUI (Optional)\n');

  const enableGateway = await confirm({
    message: 'Enable Gateway WebUI?',
    default: true,
  });

  if (!enableGateway) {
    config.gateway = config.gateway || {};
    config.gateway.auth = { mode: 'none' };
    console.log('ℹ️  Gateway disabled (auth mode set to none)');
    return config;
  }

  const existingToken = config?.gateway?.auth?.token;
  const existingMode = config?.gateway?.auth?.mode;

  if (existingToken && existingMode === 'token') {
    console.log('\nℹ️  Gateway auth token already configured');
    const keepExisting = await confirm({
      message: 'Keep existing token?',
      default: true,
    });

    if (keepExisting) {
      console.log('✅ Keeping existing gateway configuration');
      return config;
    }
  }

  const crypto = await import('crypto');
  const token = crypto.randomBytes(24).toString('hex');

  config.gateway = config.gateway || {};
  config.gateway.bind = config.gateway.bind || 'loopback';
  config.gateway.port = config.gateway.port || 18790;
  config.gateway.auth = {
    mode: 'token',
    token,
  };

  console.log('\n✅ Gateway configured:');
  console.log(`   Bind: ${config.gateway.bind}`);
  console.log(`   Port: ${config.gateway.port}`);
  console.log(`   Auth: Token-based (auto-generated)`);
  console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);

  return config;
}

async function installAndStartGatewayService(config: Config, ctx: CLIContext): Promise<boolean> {
  const [{ resolveGatewayService, isDaemonAvailableAsync, getPlatformName }, { buildGatewayInstallArgs }] =
    await Promise.all([
      import('../../../daemon/service.js'),
      import('../../../daemon/install-plan.js'),
    ]);

  const available = await isDaemonAvailableAsync();
  if (!available) {
    console.log(`ℹ️  OS service not available on ${getPlatformName()}.`);
    console.log('   Start manually with: xopc gateway');
    return false;
  }

  const service = await resolveGatewayService();
  const port = config.gateway?.port ?? 18790;
  const bind = config.gateway?.bind ?? 'loopback';
  const token = config.gateway?.auth?.token;

  const loaded = await service.isLoaded({ env: process.env }).catch(() => false);
  if (!loaded) {
    const installArgs = buildGatewayInstallArgs({ port, bind, token });
    installArgs.stdout = process.stdout;
    await service.install(installArgs);
  }

  const { startGatewayService } = await import('../../../daemon/service.js');
  const result = await startGatewayService({ service });
  return result.outcome === 'started' || result.outcome === 'scheduled';
}

export async function startGatewayNow(config: Config, ctx: CLIContext): Promise<void> {
  const bind = config?.gateway?.bind ?? 'loopback';
  const port = config?.gateway?.port || 18790;
  const displayHost = bind === 'lan' ? 'localhost' : '127.0.0.1';

  let isRunning = false;
  try {
    const lock = await acquireGatewayLock(ctx.configPath, { timeoutMs: 100, port });
    await lock.release();
  } catch (err) {
    if (err instanceof GatewayLockError) {
      isRunning = true;
    }
  }

  if (isRunning) {
    console.log('\n🌐 Gateway is already running!');
    console.log(`   URL: http://${displayHost}:${port}`);
    console.log('');
    console.log('📝 To apply the new configuration, restart gateway:');
    console.log('   xopc gateway restart');
  } else if (isInteractive()) {
    const shouldInstall = await confirm({
      message: 'Install and start Gateway as an OS service now?',
      default: true,
    });

    if (shouldInstall) {
      console.log('\n🚀 Installing Gateway service...');
      try {
        const started = await installAndStartGatewayService(config, ctx);
        if (started) {
          console.log('✅ Gateway service installed and started');
          console.log(`   URL: http://${displayHost}:${port}`);
          const token = config?.gateway?.auth?.token;
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }
        } else {
          console.log('⚠️  Service install completed but start may need manual action.');
          console.log('   Try: xopc gateway service start');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`⚠️  Failed to install/start gateway service: ${message}`);
        console.log('   Start manually with: xopc gateway');
      }
    } else {
      console.log('\n⏭️  Skipping gateway service install.');
      console.log('   Start in foreground with: xopc gateway');
      console.log('   Or install service later: xopc gateway service install');
    }
  } else {
    console.log('\n🚀 Gateway is configured but not running.');
    console.log('');
    console.log('📝 To install and start as an OS service:');
    console.log('   xopc gateway service install');
    console.log('   xopc gateway service start');
    console.log('');
    console.log('📝 To start in foreground (development):');
    console.log(`   xopc gateway --bind ${bind} --port ${port}`);
  }

  console.log('');
  console.log('📚 Other useful commands:');
  console.log('   xopc gateway status    # Check gateway status');
  console.log('   xopc gateway stop      # Stop gateway');
  console.log('   xopc gateway restart   # Restart gateway');
  console.log('   xopc gateway logs      # View logs');
}
