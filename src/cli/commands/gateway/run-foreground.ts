import type { CLIContext } from '../../registry.js';

export type GatewayRunCliOptions = {
  bind?: string;
  port?: string | number;
  token?: string;
  tailscale?: string;
  tailscaleResetOnExit?: boolean;
  force?: boolean;
  hotReload?: boolean;
  foreground?: boolean;
};

async function ensureGatewayReady(
  configPath: string,
  workspacePath: string,
  port: number,
): Promise<void> {
  const { initWorkspace } = await import('../../utils/init-workspace.js');
  const result = await initWorkspace({
    configPath,
    workspacePath,
    gatewayPort: port,
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
  }
}

export async function runGatewayFromCliOptions(
  options: GatewayRunCliOptions,
  ctx: CLIContext,
): Promise<void> {
  const tailscaleModes = new Set(['off', 'serve', 'funnel']);
  const tailscaleRaw =
    typeof options.tailscale === 'string' ? options.tailscale.trim().toLowerCase() : undefined;
  const tailscaleOverride =
    tailscaleRaw && tailscaleModes.has(tailscaleRaw)
      ? (tailscaleRaw as 'off' | 'serve' | 'funnel')
      : undefined;
  if (tailscaleRaw && !tailscaleOverride) {
    console.error(`Invalid --tailscale mode "${tailscaleRaw}". Use: off, serve, funnel.`);
    process.exit(1);
  }

  if (tailscaleOverride && tailscaleOverride !== 'off') {
    process.env.XOPC_GATEWAY_TAILSCALE_MODE = tailscaleOverride;
  }
  if (options.tailscaleResetOnExit === true) {
    process.env.XOPC_GATEWAY_TAILSCALE_RESET_ON_EXIT = '1';
  }

  const [{ loadConfig }, { resolveConfigPath }, { runGatewayLoop }, gatewayPorts, migrations] = await Promise.all([
    import('../../../config/index.js'),
    import('../../../config/paths.js'),
    import('../../../gateway/run-loop.js'),
    import('../../../gateway/ports.js'),
    import('../../../migrations/runner.js'),
  ]);
  const { checkPortAvailable, forceFreePortAndWait } = gatewayPorts;
  migrations.runBootstrapMigrationsSync(ctx.configPath);
  const config = loadConfig(ctx.configPath);

  const bindFromFlagRaw =
    typeof options.bind === 'string' && options.bind.trim().length > 0
      ? options.bind.trim().toLowerCase()
      : undefined;
  const bindModes = new Set(['auto', 'loopback', 'lan', 'tailnet', 'custom']);
  const bindFromFlag = bindFromFlagRaw && bindModes.has(bindFromFlagRaw)
    ? (bindFromFlagRaw as import('../../../config/schema.js').GatewayBindMode)
    : undefined;
  if (bindFromFlagRaw && !bindFromFlag) {
    console.error(`Invalid --bind mode "${bindFromFlagRaw}". Use: loopback, lan, auto, custom, tailnet.`);
    process.exit(1);
  }

  const portRaw = options.port;
  const portFromFlag =
    portRaw !== undefined && portRaw !== null && String(portRaw).trim().length > 0
      ? parseInt(String(portRaw), 10)
      : undefined;

  const { resolveGatewayListenPlan } = await import('../../../gateway/listen.js');
  const listenPlan = resolveGatewayListenPlan({
    cfg: config,
    bindOverride: bindFromFlag,
  });
  const bindHost = listenPlan.bindHost;
  const port =
    portFromFlag !== undefined && Number.isFinite(portFromFlag)
      ? portFromFlag
      : (typeof config.gateway.port === 'number' ? config.gateway.port : 18790);

  await ensureGatewayReady(ctx.configPath, ctx.workspacePath, port);

  const effectiveConfig = loadConfig(ctx.configPath);
  const { resolveGatewayAuth, assertGatewayAuthConfigured } = await import('../../../gateway/auth.js');
  const { assertGatewayRuntimeConfig } = await import('../../../gateway/runtime-config.js');

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
      port,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Gateway refused to start: ${message}`);
    process.exit(1);
  }

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

  const portAvailable = await checkPortAvailable(port, bindHost);
  if (!portAvailable) {
    console.error(`Port ${port} is already in use. Use --force to kill existing process.`);
    process.exit(1);
  }

  console.log('🚀 Starting xopc gateway...');
  console.log(`   Bind: ${listenPlan.bindMode} (${bindHost})`);
  console.log(`   Port: ${port}`);
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');

  await runGatewayLoop({
    configPath: ctx.configPath || resolveConfigPath(),
    port,
    start: async () => {
      const { GatewayServer } = await import('../../../gateway/index.js');
      const server = new GatewayServer({
        bindHost: listenPlan.bindHost,
        bind: listenPlan.bindMode,
        customBindHost: listenPlan.customBindHost,
        port,
        token: options.token || config?.gateway?.auth?.token,
        verbose: ctx.isVerbose,
        configPath: ctx.configPath,
        enableHotReload: options.hotReload,
      });
      await server.start();

      const displayHost = bindHost === '0.0.0.0' ? 'localhost' : bindHost;
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
}
