import { Command } from 'commander';

import { loadConfig } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { resolveTunnelBrokerUrl, resolveTunnelRegistrationSecret } from '../../tunnel/env.js';
import { getTunnelService } from '../../tunnel/index.js';
import { loadTunnelState } from '../../tunnel/tunnel-state.js';
import { formatExamples, register, type CLIContext } from '../registry.js';

const log = createLogger('TunnelCommand');

function resolveGatewayPortHost(config: ReturnType<typeof loadConfig>): { port: number; host: string } {
  return {
    port: config.gateway.port ?? 18790,
    host: config.gateway.host ?? '127.0.0.1',
  };
}

function resolveGatewayToken(config: ReturnType<typeof loadConfig>): string {
  const fromEnv = process.env.XOPC_GATEWAY_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const token = config.gateway.auth?.token?.trim();
  if (token) return token;
  throw new Error('Gateway token not configured. Set gateway.auth.token or XOPC_GATEWAY_TOKEN.');
}

function configureTunnel(ctx: CLIContext): void {
  const config = loadConfig(ctx.configPath);
  const { port, host } = resolveGatewayPortHost(config);
  getTunnelService().configure({
    brokerUrl: resolveTunnelBrokerUrl(config.tunnel?.brokerUrl),
    registrationSecret: resolveTunnelRegistrationSecret(),
    autoStart: config.tunnel?.autoStart ?? false,
    gatewayHost: host,
  });
  void port;
}

function createTunnelCommand(ctx: CLIContext): Command {
  const cmd = new Command('tunnel')
    .description('Manage FRP remote access tunnel')
    .addHelpText(
      'after',
      formatExamples([
        'xopc tunnel start',
        'xopc tunnel stop',
        'xopc tunnel status',
        'xopc tunnel qr',
      ]),
    );

  cmd
    .command('start')
    .description('Register tunnel, start frpc, print connection info')
    .action(async () => {
      configureTunnel(ctx);
      const config = loadConfig(ctx.configPath);
      const { port, host } = resolveGatewayPortHost(config);
      const token = resolveGatewayToken(config);
      const tunnel = getTunnelService();

      console.log('🚀 Starting tunnel...');
      try {
        const qr = await tunnel.start(port, token);
        const status = tunnel.getStatus();
        console.log('');
        console.log('✅ Tunnel is active');
        if (status.publicUrl) console.log(`   URL: ${status.publicUrl}`);
        if (qr.lanUrl) console.log(`   LAN: ${qr.lanUrl}`);
        console.log('');
        console.log('📱 Mobile connect QR payload:');
        console.log(qr.qrPayload);
        console.log('');
        console.log(
          `💡 Gateway must be running at ${host}:${port}. Keep frpc alive or use gateway / Web console.`,
        );
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        log.error({ err }, `Tunnel start failed: ${em}`);
        process.exit(1);
      }
    });

  cmd
    .command('stop')
    .description('Stop frpc and deregister tunnel')
    .action(async () => {
      configureTunnel(ctx);
      await getTunnelService().stop();
      console.log('Tunnel stopped.');
    });

  cmd
    .command('status')
    .description('Show tunnel status')
    .action(() => {
      configureTunnel(ctx);
      const status = getTunnelService().getStatus();
      const persisted = loadTunnelState();
      console.log(JSON.stringify({ ...status, persistedSubdomain: persisted?.subdomain ?? null }, null, 2));
    });

  cmd
    .command('qr')
    .description('Print mobile connect QR payload (tunnel must be active)')
    .action(() => {
      configureTunnel(ctx);
      const config = loadConfig(ctx.configPath);
      const { port, host } = resolveGatewayPortHost(config);
      const token = resolveGatewayToken(config);
      const qr = getTunnelService().buildQr(port, host, token);
      if (!qr.qrPayload) {
        console.error('No active tunnel. Run: xopc tunnel start');
        process.exit(1);
      }
      console.log(qr.qrPayload);
    });

  return cmd;
}

register({
  id: 'tunnel',
  name: 'tunnel',
  description: 'FRP remote access tunnel',
  factory: createTunnelCommand,
  metadata: {
    category: 'runtime',
    examples: ['xopc tunnel start', 'xopc tunnel status'],
  },
});
