import { Command } from 'commander';
import { spawn } from 'child_process';
import { loadConfig } from '../../../config/index.js';
import { createLogger } from '../../../utils/logger.js';
import { getContextWithOpts } from '../../index.js';
import { forceFreePortAndWait, listPortListeners } from '../../../gateway/ports.js';

const _log = createLogger('GatewayRestartCommand');

/**
 * Create restart subcommand
 */
export function createRestartCommand(): Command {
  return new Command('restart')
    .description('Restart gateway')
    .option('--force', 'Force restart (kill if needed)', false)
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const config = loadConfig(ctx.configPath);
      const port = config?.gateway?.port || 18790;
      const host = config?.gateway?.host || '0.0.0.0';

      // Find existing process
      const listeners = listPortListeners(port);

      if (listeners.length === 0) {
        // Gateway is not running, start it in background
        console.log('🚀 Gateway is not running, starting...');
        console.log(`   Host: ${host}`);
        console.log(`   Port: ${port}`);
        console.log('');

        const args = process.argv.slice(1).filter(arg => 
          arg !== 'restart' && !arg.startsWith('--force')
        );
        args.push('--background');

        const child = spawn(process.execPath, args, {
          detached: true,
          stdio: 'ignore',
          env: process.env,
        });

        child.unref();

        // Wait a moment to check if process started successfully
        await new Promise(resolve => setTimeout(resolve, 500));

        if (child.pid && !child.killed) {
          const displayHost = host === '0.0.0.0' ? 'localhost' : host;
          console.log('✅ Gateway started');
          console.log(`   PID: ${child.pid}`);
          console.log(`   URL: http://${displayHost}:${port}`);
          const token = config?.gateway?.auth?.token;
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }
          process.exit(0);
        } else {
          console.error('❌ Failed to start gateway');
          process.exit(1);
        }
        return;
      }

      if (options.force) {
        // Force kill then start new
        console.log('🔄 Force restarting gateway...');
        try {
          await forceFreePortAndWait(port, {
            timeoutMs: 2000,
            sigtermTimeoutMs: 700,
          });
          console.log('✅ Gateway stopped');
          console.log('');

          // Start new instance in background
          const args = process.argv.slice(1).filter(arg => 
            arg !== 'restart' && !arg.startsWith('--force')
          );
          args.push('--background');

          const child = spawn(process.execPath, args, {
            detached: true,
            stdio: 'ignore',
            env: process.env,
          });

          child.unref();

          await new Promise(resolve => setTimeout(resolve, 500));

          if (child.pid && !child.killed) {
            const displayHost = host === '0.0.0.0' ? 'localhost' : host;
            console.log('✅ Gateway started');
            console.log(`   PID: ${child.pid}`);
            console.log(`   URL: http://${displayHost}:${port}`);
            process.exit(0);
          } else {
            console.error('❌ Failed to start gateway');
            process.exit(1);
          }
        } catch (err) {
          console.error('❌ Failed to stop gateway:', err);
          process.exit(1);
        }
        return;
      }

      // Send SIGUSR1 to trigger graceful restart
      for (const proc of listeners) {
        try {
          // Enable SIGUSR1 restart temporarily
          process.env.XOPCBOT_ALLOW_SIGUSR1_RESTART = '1';
          process.kill(proc.pid, 'SIGUSR1');
          console.log(`✅ Restart signal sent to gateway (pid ${proc.pid})`);
          console.log('   Gateway will restart gracefully...');
          process.exit(0);
        } catch (err) {
          console.error(`❌ Failed to send restart signal: ${String(err)}`);
        }
      }
      process.exit(1);
    });
}
