/**
 * Gateway Configuration and Startup for Onboarding
 */

import { confirm } from '@inquirer/prompts';
import { spawn } from 'child_process';
import type { Config } from '../../../config/schema.js';
import type { CLIContext } from '../../registry.js';
import { acquireGatewayLock, GatewayLockError } from '../../../gateway/lock.js';

/**
 * Check if running in interactive mode
 */
function isInteractive(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

/**
 * Configure Gateway WebUI
 */
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

  // Check if gateway auth is already configured
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

  // Generate new token
  const crypto = await import('crypto');
  const token = crypto.randomBytes(24).toString('hex');

  // Configure gateway with defaults
  config.gateway = config.gateway || {};
  config.gateway.host = config.gateway.host || '0.0.0.0';
  config.gateway.port = config.gateway.port || 18790;
  config.gateway.auth = {
    mode: 'token',
    token,
  };

  console.log('\n✅ Gateway configured:');
  console.log(`   Host: ${config.gateway.host}`);
  console.log(`   Port: ${config.gateway.port}`);
  console.log(`   Auth: Token-based (auto-generated)`);
  console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);

  return config;
}

/**
 * Handle gateway startup after onboarding.
 * In interactive mode, asks user if they want to start gateway in background.
 * In non-interactive mode, provides guidance on how to start manually.
 */
export async function startGatewayNow(config: Config, ctx: CLIContext): Promise<void> {
  const host = config?.gateway?.host || '0.0.0.0';
  const port = config?.gateway?.port || 18790;
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;

  // Check if gateway is already running by trying to acquire lock
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
    // Gateway is running - provide restart guidance
    console.log('\n🌐 Gateway is already running!');
    console.log(`   URL: http://${displayHost}:${port}`);
    console.log('');
    console.log('📝 To apply the new configuration, restart gateway:');
    console.log('   xopcbot gateway restart');
  } else {
    // Gateway is not running
    if (isInteractive()) {
      // Interactive mode: ask user if they want to start gateway
      const shouldStart = await confirm({
        message: 'Start Gateway WebUI now (background mode)?',
        default: true,
      });

      if (shouldStart) {
        console.log('\n🚀 Starting Gateway WebUI in background...');
        console.log('');

        const args = [
          ...process.execArgv,
          ...process.argv.slice(1).filter(arg => !arg.includes('onboard') && arg !== '--quick'),
          'gateway',
          '--background',
          '--host', host,
          '--port', String(port),
        ];

        const child = spawn(process.execPath, args, {
          detached: true,
          stdio: 'ignore',
          env: process.env,
        });

        child.unref();

        // Wait a moment to check if process started successfully
        await new Promise(resolve => setTimeout(resolve, 500));

        if (child.pid && !child.killed) {
          console.log('✅ Gateway started in background');
          console.log(`   PID: ${child.pid}`);
          console.log(`   URL: http://${displayHost}:${port}`);
          const token = config?.gateway?.auth?.token;
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }
        } else {
          console.log('⚠️  Failed to start gateway automatically.');
          console.log('   You can start it manually with:');
          console.log(`   xopcbot gateway --background`);
        }
      } else {
        // User chose not to start
        console.log('\n⏭️  Skipping gateway startup.');
        console.log('   You can start it later with:');
        console.log(`   xopcbot gateway --background`);
      }
    } else {
      // Non-interactive mode: provide guidance
      console.log('\n🚀 Gateway is configured but not running.');
      console.log('');
      console.log('📝 To start the gateway in background:');
      console.log(`   xopcbot gateway --background`);
      console.log('');
      console.log('📝 To start in foreground (development mode):');
      console.log(`   pnpm run dev -- gateway --host ${host} --port ${port}`);
    }
  }

  console.log('');
  console.log('📚 Other useful commands:');
  console.log('   xopcbot gateway status    # Check gateway status');
  console.log('   xopcbot gateway stop      # Stop gateway');
  console.log('   xopcbot gateway restart   # Restart gateway');
  console.log('   xopcbot gateway logs      # View logs');
}
