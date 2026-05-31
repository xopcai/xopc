import type { Command } from 'commander';

import type { CLIContext } from '../../registry.js';
import {
  isKnownGatewaySubcommand,
  resolveGatewaySubcommandName,
} from '../../gateway-run-argv.js';
import { resolveCliArgvInvocation } from '../../argv-invocation.js';

type GatewaySubcommandLoader = () => Promise<Command>;

const GATEWAY_SUBCOMMAND_LOADERS: Record<string, GatewaySubcommandLoader> = {
  token: async () => (await import('./token.js')).createTokenCommand(),
  status: async () => (await import('./status.js')).createStatusCommand(),
  health: async () => (await import('./health.js')).createHealthCommand(),
  call: async () => (await import('./call.js')).createCallCommand(),
  probe: async () => (await import('./probe.js')).createProbeCommand(),
  stop: async () => (await import('./stop.js')).createStopCommand(),
  restart: async () => (await import('./restart.js')).createRestartCommand(),
  logs: async () => (await import('./logs.js')).createLogsCommand(),
  install: async () => (await import('./service.js')).createInstallCommand(),
  uninstall: async () => (await import('./service.js')).createUninstallCommand(),
  start: async () => (await import('./service.js')).createServiceStartCommand(),
  'service-status': async () => (await import('./service.js')).createServiceStatusCommand(),
};

async function attachAllGatewaySubcommands(cmd: Command, ctx: CLIContext): Promise<void> {
  for (const loader of Object.values(GATEWAY_SUBCOMMAND_LOADERS)) {
    cmd.addCommand(await loader());
  }
  const { registerGatewaySshTunnelCommand } = await import('../gateway-ssh-tunnel.js');
  registerGatewaySshTunnelCommand(cmd, ctx);
}

function shouldEagerLoadGatewaySubcommands(argv: string[]): boolean {
  const invocation = resolveCliArgvInvocation(argv);
  if (!invocation.hasHelpOrVersion) {
    return false;
  }
  const gatewayPath = resolveGatewaySubcommandName(argv);
  return gatewayPath === undefined;
}

export async function prepareGatewayCommandForArgv(cmd: Command, ctx: CLIContext): Promise<void> {
  const subcommand = resolveGatewaySubcommandName(ctx.argv);
  if (subcommand === 'ssh-tunnel') {
    const { registerGatewaySshTunnelCommand } = await import('../gateway-ssh-tunnel.js');
    registerGatewaySshTunnelCommand(cmd, ctx);
    return;
  }
  if (subcommand && isKnownGatewaySubcommand(subcommand)) {
    const loader = GATEWAY_SUBCOMMAND_LOADERS[subcommand];
    if (loader) {
      cmd.addCommand(await loader());
    }
    return;
  }
  if (shouldEagerLoadGatewaySubcommands(ctx.argv)) {
    await attachAllGatewaySubcommands(cmd, ctx);
  }
}
