import { Command } from 'commander';
import { resolveConfigPath } from '../../../config/paths.js';
import { getContextWithOpts } from '../../context.js';
import { createRestartCommand } from './restart.js';
import { createStopCommand } from './stop.js';

/**
 * Create service install subcommand - actually installs the OS service
 */
export function createInstallCommand(): Command {
  return new Command('install')
    .description('Install gateway as OS service (LaunchAgent / systemd / Task)')
    .option('--port <port>', 'Gateway port')
    .option('--token <token>', 'Gateway auth token')
    .option('--force', 'Force reinstall if already installed')
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const configPath = ctx.configPath || resolveConfigPath();

      const [{ loadConfig }, { resolveGatewayService, isDaemonAvailableAsync, getPlatformName }, { buildGatewayInstallArgs }] =
        await Promise.all([
          import('../../../config/index.js'),
          import('../../../daemon/service.js'),
          import('../../../daemon/install-plan.js'),
        ]);

      const config = loadConfig(configPath);
      const port = options.port ? parseInt(options.port, 10) : (config?.gateway?.port || 18790);
      const bind = config?.gateway?.bind ?? 'loopback';
      const token = options.token || config?.gateway?.auth?.token;

      const available = await isDaemonAvailableAsync();
      if (!available) {
        if (options.json) {
          console.log(JSON.stringify({ ok: false, error: 'Daemon not available' }));
        } else {
          console.error(`❌ OS service not available on ${getPlatformName()}`);
        }
        process.exit(1);
      }

      const service = await resolveGatewayService();

      // Check if already installed
      const loaded = await service.isLoaded({ env: process.env });
      if (loaded && !options.force) {
        if (options.json) {
          console.log(JSON.stringify({ ok: true, result: 'already-installed' }));
        } else {
          console.log('ℹ️  Service already installed. Use --force to reinstall.');
        }
        return;
      }

      // Uninstall first if force
      if (loaded && options.force) {
        try {
          await service.uninstall({ env: process.env });
        } catch {
          // Best-effort
        }
      }

      // Build install args and install
      const installArgs = buildGatewayInstallArgs({ port, bind, token });
      installArgs.stdout = process.stdout;

      try {
        await service.install(installArgs);

        if (options.json) {
          console.log(JSON.stringify({ ok: true, result: 'installed', label: service.label, port }));
        } else {
          console.log('');
          console.log(`✅ Gateway service installed`);
          console.log(`   Service: ${service.label}`);
          console.log(`   Port: ${port}`);
          console.log('');
          console.log('💡 The service will start automatically on login.');
          console.log('   Use `xopc gateway status` to verify.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (options.json) {
          console.log(JSON.stringify({ ok: false, error: message }));
        } else {
          console.error(`❌ Failed to install service: ${message}`);
        }
        process.exit(1);
      }
    });
}

/**
 * Create service uninstall subcommand
 */
export function createUninstallCommand(): Command {
  return new Command('uninstall')
    .description('Uninstall gateway OS service')
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const { executeDaemonUninstall } = await import('./lifecycle-core.js');
      await executeDaemonUninstall(options);
    });
}

/**
 * Create service start subcommand - starts via daemon service manager
 */
export function createServiceStartCommand(): Command {
  return new Command('start')
    .description('Start gateway via OS service manager')
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const [{ resolveGatewayService, startGatewayService, isDaemonAvailableAsync }] =
        await Promise.all([import('../../../daemon/service.js')]);

      const available = await isDaemonAvailableAsync();
      if (!available) {
        console.error('❌ Daemon not available on this platform');
        process.exit(1);
      }

      const service = await resolveGatewayService();
      const result = await startGatewayService({ service });

      if (options.json) {
        console.log(JSON.stringify({ ok: result.task === 'started', task: result.task }));
        return;
      }

      switch (result.task) {
        case 'started':
          console.log('✅ Gateway service started');
          break;
        case 'missing-install':
          console.error('❌ Service not installed. Run: xopc gateway service install');
          process.exit(1);
          break;
        case 'repair-required':
          console.error('⚠️  Service needs repair:');
          for (const issue of result.issues || []) {
            console.error(`   - ${issue.message}`);
          }
          console.log('💡 Run: xopc gateway service install --force');
          process.exit(1);
          break;
        default:
          console.log(`ℹ️  Service start task: ${result.task}`);
      }
    });
}

/**
 * Create service status subcommand
 */
export function createServiceStatusCommand(): Command {
  return new Command('status')
    .description('Show OS service status')
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const [{ resolveGatewayService, isDaemonAvailableAsync, getPlatformName }] =
        await Promise.all([import('../../../daemon/service.js')]);

      const available = await isDaemonAvailableAsync();
      if (!available) {
        if (options.json) {
          console.log(JSON.stringify({ available: false, platform: process.platform }));
        } else {
          console.log(`ℹ️  Daemon not available on ${getPlatformName()}`);
        }
        return;
      }

      const service = await resolveGatewayService();
      const [loaded, runtime, command] = await Promise.all([
        service.isLoaded({ env: process.env }),
        service.readRuntime(),
        service.readCommand(),
      ]);

      if (options.json) {
        console.log(JSON.stringify({ available: true, loaded, runtime, command, label: service.label }, null, 2));
        return;
      }

      console.log('📊 Gateway Service Status');
      console.log('');
      console.log(`   Platform: ${getPlatformName()}`);
      console.log(`   Service:  ${loaded ? service.loadedText : service.notLoadedText}`);
      console.log(`   Runtime:  ${runtime.status}${runtime.pid ? ` (pid ${runtime.pid})` : ''}`);

      if (command) {
        const portMatch = command.programArguments.join(' ').match(/--port\s+(\d+)/);
        if (portMatch) {
          console.log(`   Port:     ${portMatch[1]}`);
        }
        const version = command.environment?.XOPC_SERVICE_VERSION;
        if (version) {
          console.log(`   Version:  ${version}`);
        }
      }

      if (!loaded) {
        console.log('');
        console.log('💡 Install with: xopc gateway service install');
      }
    });
}

/**
 * Gateway OS service command group (`xopc gateway service …`).
 */
export function createServiceCommand(): Command {
  const cmd = new Command('service').description(
    'Manage gateway OS service (LaunchAgent / systemd / Task)',
  );
  cmd.addCommand(createInstallCommand());
  cmd.addCommand(createUninstallCommand());
  cmd.addCommand(createServiceStartCommand());
  cmd.addCommand(createServiceStatusCommand());
  cmd.addCommand(createStopCommand());
  cmd.addCommand(createRestartCommand());
  return cmd;
}
