import { Command } from 'commander';
import { resolveConfigPath } from '../../../config/paths.js';
import { getContextWithOpts } from '../../index.js';

async function loadServiceDeps() {
  const [{ loadConfig }, { createLogger }, daemon, { buildGatewayInstallPlan }] = await Promise.all([
    import('../../../config/index.js'),
    import('../../../utils/logger.js'),
    import('../../../daemon/index.js'),
    import('../../../daemon/install-plan.js'),
  ]);
  return {
    loadConfig,
    log: createLogger('GatewayServiceCommand'),
    resolveGatewayService: daemon.resolveGatewayService,
    isDaemonAvailableAsync: daemon.isDaemonAvailableAsync,
    getPlatformName: daemon.getPlatformName,
    buildGatewayInstallPlan,
  };
}

/**
 * Create service install subcommand
 */
export function createInstallCommand(): Command {
  return new Command('install')
    .description('Install gateway as system service')
    .action(async () => {
      const ctx = getContextWithOpts();
      const configPath = ctx.configPath || resolveConfigPath();
      const {
        loadConfig,
        log,
        resolveGatewayService,
        isDaemonAvailableAsync,
        getPlatformName,
        buildGatewayInstallPlan,
      } = await loadServiceDeps();
      const config = loadConfig(configPath);
      const port = config?.gateway?.port || 18790;
      const host = config?.gateway?.host || '0.0.0.0';
      const token = config?.gateway?.auth?.token;

      // Check if daemon is available
      const daemonAvailable = await isDaemonAvailableAsync();
      if (!daemonAvailable) {
        console.log('❌ System service installation is not available on this platform.');
        console.log(`   Platform: ${getPlatformName()}`);
        console.log('');
        console.log('💡 You can still run gateway manually:');
        console.log('   xopc gateway --background');
        process.exit(1);
      }

      console.log('🔧 Installing gateway as system service...');
      console.log(`   Config: ${configPath}`);
      console.log(`   Port: ${port}`);
      console.log('');

      try {
        const service = await resolveGatewayService();
        const plan = buildGatewayInstallPlan({
          port,
          host,
          token,
        });

        console.log('📋 Service configuration:');
        console.log(`   Label: ${service.label}`);
        console.log(`   Working Directory: ${plan.workingDirectory}`);
        console.log('');
        console.log('📋 Install command:');
        console.log(`   Program: ${plan.programArguments[0]}`);
        console.log(`   Args: ${plan.programArguments.slice(1).join(' ')}`);
        console.log('');

        // Platform-specific installation
        const platform = process.platform;
        
        if (platform === 'linux') {
          console.log('🐧 Installing systemd service...');
          console.log('');
          console.log('To install manually, create a systemd service file:');
          console.log('   sudo nano /etc/systemd/system/xopc-gateway.service');
          console.log('');
          console.log('Then run:');
          console.log('   sudo systemctl daemon-reload');
          console.log('   sudo systemctl enable xopc-gateway');
          console.log('   sudo systemctl start xopc-gateway');
        } else if (platform === 'darwin') {
          console.log('🍎 Installing LaunchAgent (user)...');
          console.log('');
          console.log('To install manually, create a plist file:');
          console.log('   nano ~/Library/LaunchAgents/ai.xopc.xopc.gateway.plist');
          console.log('');
          console.log('Then run:');
          console.log('   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.xopc.xopc.gateway.plist');
        } else if (platform === 'win32') {
          console.log('🪟 Installing Windows service...');
          console.log('');
          console.log('To install manually, run as Administrator:');
          console.log('   sc create xopc-gateway binPath= "..."');
          console.log('   sc start xopc-gateway');
        }

        console.log('');
        console.log('⚠️  Automatic installation requires elevated privileges.');
        console.log('   Please run the commands above with sudo/Administrator.');
        process.exit(0);
      } catch (err) {
        log.error({ err }, 'Failed to install service');
        console.error('❌ Failed to install service:', err);
        process.exit(1);
      }
    });
}

/**
 * Create service uninstall subcommand
 */
export function createUninstallCommand(): Command {
  return new Command('uninstall')
    .description('Uninstall gateway system service')
    .action(async () => {
      const ctx = getContextWithOpts();
      const _configPath = ctx.configPath || resolveConfigPath();
      const { log, resolveGatewayService } = await loadServiceDeps();

      console.log('🔧 Uninstalling gateway system service...');

      try {
        const service = await resolveGatewayService();
        
        console.log(`   Service: ${service.label}`);
        console.log('');
        console.log('To uninstall manually:');
        console.log('   Linux: sudo systemctl stop xopc-gateway && sudo systemctl disable xopc-gateway');
        console.log(
          '   macOS: launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.xopc.xopc.gateway.plist',
        );
        console.log('   Windows: sc stop xopc-gateway && sc delete xopc-gateway');
        process.exit(0);
      } catch (err) {
        log.error({ err }, 'Failed to uninstall service');
        console.error('❌ Failed to uninstall service:', err);
        process.exit(1);
      }
    });
}

/**
 * Create service start subcommand
 */
export function createServiceStartCommand(): Command {
  return new Command('start')
    .description('Start gateway system service')
    .action(async () => {
      const ctx = getContextWithOpts();
      const configPath = ctx.configPath || resolveConfigPath();
      const { loadConfig } = await loadServiceDeps();
      const config = loadConfig(configPath);
      const port = config?.gateway?.port || 18790;

      console.log('🚀 Starting gateway service...');
      console.log(`   Port: ${port}`);
      console.log('');
      console.log('To start manually:');
      console.log('   Linux: sudo systemctl start xopc-gateway');
      console.log(
        '   macOS: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.xopc.xopc.gateway.plist',
      );
      console.log('   Windows: sc start xopc-gateway');
      process.exit(0);
    });
}

/**
 * Create service status subcommand
 */
export function createServiceStatusCommand(): Command {
  return new Command('service-status')
    .description('Check system service status')
    .action(async () => {
      console.log('📊 Gateway service status');
      console.log('');
      console.log('To check manually:');
      console.log('   Linux: sudo systemctl status xopc-gateway');
      console.log('   macOS: sudo launchctl list | grep xopc');
      console.log('   Windows: sc query xopc-gateway');
      process.exit(0);
    });
}
