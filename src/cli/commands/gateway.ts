import { spawn } from 'child_process';

import { Command } from 'commander';

import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';
import {
  createTokenCommand,
  createStatusCommand,
  createHealthCommand,
  createCallCommand,
  createProbeCommand,
  createStopCommand,
  createRestartCommand,
  createLogsCommand,
  createInstallCommand,
  createUninstallCommand,
  createServiceStartCommand,
  createServiceStatusCommand,
} from './gateway/index.js';

async function ensureGatewayReady(
  configPath: string,
  workspacePath: string,
  gatewayHost: string,
  gatewayPort: number,
): Promise<void> {
  const [{ initWorkspace }, { seedMainAgentProfileMarkdown }] = await Promise.all([
    import('../utils/init-workspace.js'),
    import('../../agent/context/workspace-seed.js'),
  ]);
  const result = await initWorkspace({
    configPath,
    workspacePath,
    gatewayHost,
    gatewayPort,
  });

  if (result.configCreated || result.workspaceCreated) {
    console.log('');
    console.log('👋 Welcome to xopc! Running first-time setup before starting the gateway...');
    console.log('');
    console.log('✅ First-time setup complete!');
    console.log(`   Config:    ${configPath}`);
    console.log(`   Workspace: ${workspacePath}`);
    console.log(`   Token:     ${result.token.slice(0, 8)}...${result.token.slice(-8)}`);
    console.log('');
    console.log('💡 Tip: run `xopc onboard` anytime to configure models, channels, and more.');
    console.log('');
    seedMainAgentProfileMarkdown(result.config);
  }
}

function createGatewayCommand(_ctx: CLIContext): Command {
  const cmd = new Command('gateway')
    .description('Start the xopc gateway server')
    .addHelpText(
      'after',
      formatExamples([
        'xopc gateway                   # Start gateway (foreground, default)',
        'xopc gateway --background      # Start gateway in background',
        'xopc gateway --bind lan          # Listen on all interfaces (LAN)',
        'xopc gateway --host 0.0.0.0      # Deprecated: same as --bind lan',
        'xopc gateway --port 8080       # Custom port',
        'xopc gateway --force           # Force kill existing process',
        'xopc gateway stop             # Stop gateway',
        'xopc gateway restart          # Restart gateway',
        'xopc gateway status           # Check gateway status',
        'xopc gateway health           # Check gateway health',
        'xopc gateway call status      # Call gateway API (alias)',
        'xopc gateway probe            # Probe reachability / auth',
        'xopc gateway logs             # View recent logs',
        'xopc gateway token            # Show current token',
        'xopc gateway token --generate # Generate new token',
      ])
    )
    .option(
      '--bind <mode>',
      'Bind mode: loopback | lan | auto | custom | tailnet (preferred over --host)',
    )
    .option(
      '--host <address>',
      'Deprecated: use --bind. Maps legacy host strings to bind modes.',
    )
    .option('--port <number>', 'Port to listen on (defaults to gateway.port in config, else 18790)')
    .option('--token <token>', 'Authentication token')
    .option('--force', 'Force kill existing process on port', false)
    .option('--no-hot-reload', 'Disable config hot reload')
    .option('--foreground', 'Start gateway in foreground mode (blocks terminal)', true)
    .option('--background', 'Start gateway in background mode (detached)', false)
    .addCommand(createTokenCommand())
    .addCommand(createStatusCommand())
    .addCommand(createHealthCommand())
    .addCommand(createCallCommand())
    .addCommand(createProbeCommand())
    .addCommand(createStopCommand())
    .addCommand(createRestartCommand())
    .addCommand(createLogsCommand())
    .addCommand(createInstallCommand())
    .addCommand(createUninstallCommand())
    .addCommand(createServiceStartCommand())
    .addCommand(createServiceStatusCommand())
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const [{ loadConfig }, { resolveConfigPath }, { runGatewayLoop }, gatewayPorts] = await Promise.all([
        import('../../config/index.js'),
        import('../../config/paths.js'),
        import('../../gateway/run-loop.js'),
        import('../../gateway/ports.js'),
      ]);
      const { checkPortAvailable, forceFreePortAndWait } = gatewayPorts;
      const config = loadConfig(ctx.configPath);

      const bindFromFlagRaw =
        typeof options.bind === 'string' && options.bind.trim().length > 0
          ? options.bind.trim().toLowerCase()
          : undefined;
      const bindModes = new Set(['auto', 'loopback', 'lan', 'tailnet', 'custom']);
      const bindFromFlag = bindFromFlagRaw && bindModes.has(bindFromFlagRaw)
        ? (bindFromFlagRaw as import('../../config/schema.js').GatewayBindMode)
        : undefined;
      if (bindFromFlagRaw && !bindFromFlag) {
        console.error(`Invalid --bind mode "${bindFromFlagRaw}". Use: loopback, lan, auto, custom, tailnet.`);
        process.exit(1);
      }

      const hostFromFlag =
        typeof options.host === 'string' && options.host.trim().length > 0 ? options.host.trim() : undefined;
      if (hostFromFlag && !bindFromFlag) {
        console.warn('Warning: `--host` is deprecated; prefer `--bind` (e.g. `--bind lan`).');
      }

      const portRaw = options.port as string | number | undefined;
      const portFromFlag =
        portRaw !== undefined && portRaw !== null && String(portRaw).trim().length > 0
          ? parseInt(String(portRaw), 10)
          : undefined;

      const { resolveGatewayListenPlan } = await import('../../gateway/listen.js');
      const listenPlan = resolveGatewayListenPlan({
        cfg: config,
        bindOverride: bindFromFlag,
        hostOverride: hostFromFlag,
      });
      const host = listenPlan.bindHost;
      const port =
        portFromFlag !== undefined && Number.isFinite(portFromFlag)
          ? portFromFlag
          : (typeof config.gateway.port === 'number' ? config.gateway.port : 18790);

      await ensureGatewayReady(ctx.configPath, ctx.workspacePath, host, port);

      const effectiveConfig = loadConfig(ctx.configPath);
      const {
        resolveGatewayAuth,
        assertGatewayAuthConfigured,
      } = await import('../../gateway/auth.js');
      const { assertGatewayRuntimeConfig } = await import('../../gateway/runtime-config.js');

      let auth = resolveGatewayAuth({ authConfig: effectiveConfig.gateway?.auth });
      if (typeof options.token === 'string' && options.token.trim().length > 0) {
        auth = { mode: 'token', token: options.token.trim() };
      }
      try {
        assertGatewayAuthConfigured(auth);
        assertGatewayRuntimeConfig({
          cfg: effectiveConfig,
          auth,
          bindOverride: bindFromFlag,
          hostOverride: hostFromFlag,
          port,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Gateway refused to start: ${message}`);
        process.exit(1);
      }

      // --force: Force free port
      if (options.force) {
        try {
          const result = await forceFreePortAndWait(port, {
            timeoutMs: 2000,
            sigtermTimeoutMs: 700,
          });
          if (result.killed.length > 0) {
            console.log(`Force killed ${result.killed.length} process(es) on port ${port}`);
            if (result.escalatedToSigkill) {
              console.log('Escalated to SIGKILL');
            }
          }
        } catch (err) {
          console.error(`Failed to free port ${port}: ${String(err)}`);
          process.exit(1);
        }
      }

      // Check if port is available
      const portAvailable = await checkPortAvailable(port, host);
      if (!portAvailable) {
        console.error(`Port ${port} is already in use. Use --force to kill existing process.`);
        process.exit(1);
      }

      // Determine if background mode (default is foreground, --background overrides)
      const isBackground = options.background === true;

      // Background mode: spawn detached process
      if (isBackground) {
        console.log('🚀 Starting xopc gateway in background...');
        console.log(`   Host: ${host}`);
        console.log(`   Port: ${port}`);
        console.log('');

        const args = [
          ...process.execArgv,
          ...process.argv.slice(1).filter(arg => arg !== '--background'),
          '--foreground', // Force foreground mode in child to prevent infinite spawn loop
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
          const displayHost = host === '0.0.0.0' ? 'localhost' : host;
          console.log('✅ Gateway started in background');
          console.log(`   PID: ${child.pid}`);
          console.log(`   URL: http://${displayHost}:${port}`);
          const token = options.token || config?.gateway?.auth?.token;
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }
          console.log('');
          console.log('📝 Management commands:');
          console.log(`   xopc gateway status     # Check status`);
          console.log(`   xopc gateway stop       # Stop gateway`);
          console.log(`   xopc gateway restart    # Restart gateway`);
          process.exit(0);
        } else {
          console.error('❌ Failed to start gateway in background');
          process.exit(1);
        }
        return;
      }

      // Foreground mode: Start gateway with run loop
      console.log('🚀 Starting xopc gateway...');
      console.log(`   Host: ${host}`);
      console.log(`   Port: ${port}`);
      console.log('');
      console.log('Press Ctrl+C to stop');
      console.log('');

      await runGatewayLoop({
        configPath: ctx.configPath || resolveConfigPath(),
        port,
        start: async () => {
          const { GatewayServer } = await import('../../gateway/index.js');
          const server = new GatewayServer({
            bindHost: listenPlan.bindHost,
            bind: listenPlan.bindMode,
            customBindHost: listenPlan.customBindHost,
            host: hostFromFlag,
            port,
            token: options.token || config?.gateway?.auth?.token,
            verbose: ctx.isVerbose,
            configPath: ctx.configPath,
            enableHotReload: options.hotReload,
          });
          await server.start();

          const displayHost = host === '0.0.0.0' ? 'localhost' : host;
          const token = options.token || config?.gateway?.auth?.token;
          console.log('✅ Gateway started');
          console.log(`   URL: http://${displayHost}:${port}`);
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }
          console.log('');

          return server;
        },
      });
    });

  return cmd;
}

register({
  id: 'gateway',
  name: 'gateway',
  description: 'Start the xopc gateway server',
  factory: createGatewayCommand,
  metadata: {
    category: 'runtime',
    examples: [
      'xopc gateway',
      'xopc gateway --background',
      'xopc gateway --port 8080',
    ],
  },
});
