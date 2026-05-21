import { Command } from 'commander';

import { loadConfig, saveConfig } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  assertTunnelMayStart,
  hasValidTunnelConsent,
  TUNNEL_RISK_SUMMARY_LINES,
  TunnelConsentError,
} from '../../tunnel/consent.js';
import { resolveTunnelBrokerUrl, resolveTunnelRegistrationSecret } from '../../tunnel/env.js';
import { ensureFrpcBinary, getTunnelService } from '../../tunnel/index.js';
import { applyTunnelConsentToConfig, setTunnelEnabledInConfig } from '../../tunnel/tunnel-config.js';
import { loadTunnelState } from '../../tunnel/tunnel-state.js';
import { formatExamples, register, type CLIContext } from '../registry.js';

const log = createLogger('TunnelCommand');

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

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
  const { host } = resolveGatewayPortHost(config);
  getTunnelService().configure({
    brokerUrl: resolveTunnelBrokerUrl(config.tunnel?.brokerUrl),
    registrationSecret: resolveTunnelRegistrationSecret(),
    autoStart: config.tunnel?.autoStart ?? false,
    gatewayHost: host,
  });
}

async function ensureCliTunnelConsent(
  ctx: CLIContext,
  opts: { acceptRisk?: boolean; yes?: boolean },
): Promise<void> {
  const config = loadConfig(ctx.configPath);
  if (hasValidTunnelConsent(config)) return;

  if (opts.acceptRisk) {
    applyTunnelConsentToConfig(config);
    await saveConfig(config, ctx.configPath);
    return;
  }

  if (opts.yes) {
    throw new TunnelConsentError(
      'Security consent not recorded. Run without --yes and confirm, or pass --accept-risk after reading the risks.',
    );
  }

  if (!isInteractive()) {
    throw new TunnelConsentError(
      'Security consent required. Run interactively, use --accept-risk, or accept in gateway settings.',
    );
  }

  const { confirm } = await import('@inquirer/prompts');
  console.log('');
  console.log('⚠️  Remote access security notice');
  for (const line of TUNNEL_RISK_SUMMARY_LINES) {
    console.log(`   • ${line}`);
  }
  console.log('');
  const accepted = await confirm({
    message: 'I understand these risks and want to enable remote access',
    default: false,
  });
  if (!accepted) {
    throw new TunnelConsentError('Remote access not started (consent declined).');
  }
  applyTunnelConsentToConfig(config);
  await saveConfig(config, ctx.configPath);
}

function createTunnelCommand(ctx: CLIContext): Command {
  const cmd = new Command('tunnel')
    .description('Manage FRP remote access tunnel')
    .addHelpText(
      'after',
      formatExamples([
        'xopc tunnel start',
        'xopc tunnel start --accept-risk',
        'xopc tunnel stop',
        'xopc tunnel status',
        'xopc tunnel qr',
        'xopc tunnel consent',
        'xopc tunnel prefetch',
      ]),
    );

  cmd
    .command('prefetch')
    .description('Download frpc to the state bin directory without starting the tunnel')
    .action(async () => {
      try {
        const path = await ensureFrpcBinary();
        console.log(`frpc ready at ${path}`);
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        log.error({ err }, `frpc prefetch failed: ${em}`);
        process.exit(1);
      }
    });

  cmd
    .command('consent')
    .description('Record acceptance of the remote access security notice')
    .option('--accept-risk', 'Non-interactive: record consent without prompts')
    .action(async (opts: { acceptRisk?: boolean }) => {
      await ensureCliTunnelConsent(ctx, { acceptRisk: opts.acceptRisk, yes: false });
      console.log('Tunnel security consent recorded.');
    });

  cmd
    .command('start')
    .description('Register tunnel, start frpc, print connection info')
    .option('--yes', 'Skip interactive consent prompt when consent is already recorded')
    .option(
      '--accept-risk',
      'Record security consent and start (non-interactive; read risks in docs/tunnel-security.md first)',
    )
    .action(async (opts: { yes?: boolean; acceptRisk?: boolean }) => {
      configureTunnel(ctx);
      await ensureCliTunnelConsent(ctx, { acceptRisk: opts.acceptRisk, yes: opts.yes });

      const config = loadConfig(ctx.configPath);
      assertTunnelMayStart(config);

      const { port, host } = resolveGatewayPortHost(config);
      const token = resolveGatewayToken(config);
      const tunnel = getTunnelService();

      console.log('🚀 Starting tunnel...');
      try {
        const qr = await tunnel.start(port, token);
        setTunnelEnabledInConfig(config, true);
        await saveConfig(config, ctx.configPath);

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
    .description('Stop frpc (keeps broker registration for stable subdomain)')
    .action(async () => {
      configureTunnel(ctx);
      await getTunnelService().stop();
      const config = loadConfig(ctx.configPath);
      setTunnelEnabledInConfig(config, false);
      await saveConfig(config, ctx.configPath);
      console.log('Tunnel stopped.');
    });

  cmd
    .command('status')
    .description('Show tunnel status')
    .action(() => {
      configureTunnel(ctx);
      const config = loadConfig(ctx.configPath);
      const status = getTunnelService().getStatus();
      const persisted = loadTunnelState();
      console.log(
        JSON.stringify(
          {
            ...status,
            persistedSubdomain: persisted?.subdomain ?? null,
            consentValid: hasValidTunnelConsent(config),
          },
          null,
          2,
        ),
      );
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
