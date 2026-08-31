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
import { resolveFrpSubdomainHost } from '../../tunnel/frp-subdomain-host.js';
import { applyTunnelConsentToConfig, mergeTunnelConfigPatch, setTunnelEnabledInConfig } from '../../tunnel/tunnel-config.js';
import { loadTunnelState } from '../../tunnel/tunnel-state.js';
import { formatExamples, register, type CLIContext } from '../registry.js';

const log = createLogger('TunnelCommand');

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

import { resolveGatewayEffectiveHost } from '../../config/gateway-bind.js';

function resolveGatewayPortHost(config: ReturnType<typeof loadConfig>): { port: number; host: string } {
  return {
    port: config.gateway.port ?? 18790,
    host: resolveGatewayEffectiveHost(config),
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
  const brokerUrl = resolveTunnelBrokerUrl(config.tunnel?.brokerUrl);
  getTunnelService().configure({
    brokerUrl,
    registrationSecret: resolveTunnelRegistrationSecret(
      brokerUrl,
      config.tunnel?.registrationSecret,
    ),
    autoStart: config.tunnel?.autoStart ?? false,
    gatewayHost: host,
    frpSubdomainHost: resolveFrpSubdomainHost(resolveTunnelBrokerUrl(config.tunnel?.brokerUrl)),
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

async function readTunnelRegistrationSecretFromCli(opts: {
  secretArg?: string;
  stdin?: boolean;
}): Promise<string> {
  const fromArg = opts.secretArg?.trim();
  if (fromArg) return fromArg;

  if (opts.stdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const value = Buffer.concat(chunks).toString('utf8').trim();
    if (!value) {
      throw new Error('Empty registration secret from stdin.');
    }
    return value;
  }

  if (isInteractive()) {
    const { password } = await import('@inquirer/prompts');
    const value = await password({
      message: 'Tunnel broker registration secret',
      mask: '*',
    });
    if (!value?.trim()) {
      throw new Error('Registration secret is required.');
    }
    return value.trim();
  }

  throw new Error(
    'Provide the secret as an argument, pass --stdin, or run in an interactive terminal.',
  );
}

async function saveTunnelRegistrationSecret(ctx: CLIContext, secret: string): Promise<void> {
  const config = loadConfig(ctx.configPath);
  const result = mergeTunnelConfigPatch(config, { registrationSecret: secret });
  if (result.ok === false) {
    throw new Error(result.message);
  }
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
        'xopc tunnel secret set',
        'xopc tunnel secret set --stdin',
      ]),
    );

  cmd
    .command('prefetch')
    .description('Download frpc to the state bin directory without starting the tunnel')
    .action(async () => {
      try {
        const path = await ensureFrpcBinary({
          onProgress: (progress) => {
            if (!process.stderr.isTTY) return;
            if (progress.phase === 'extracting') {
              process.stderr.write('\rExtracting frpc…   \n');
              return;
            }
            if (progress.percent != null) {
              process.stderr.write(`\rDownloading frpc… ${progress.percent}%`);
            } else if (progress.bytesReceived != null) {
              process.stderr.write(`\rDownloading frpc… ${progress.bytesReceived} bytes`);
            }
          },
        });
        if (process.stderr.isTTY) process.stderr.write('\n');
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

  const secretCmd = cmd.command('secret').description('Manage tunnel broker registration secret in config');

  secretCmd
    .command('set')
    .description('Save tunnel.registrationSecret to xopc.json')
    .argument('[secret]', 'Registration secret (prompts securely when omitted in a TTY)')
    .option('--stdin', 'Read secret from stdin (single line, trimmed)')
    .action(async (secretArg: string | undefined, opts: { stdin?: boolean }) => {
      try {
        const secret = await readTunnelRegistrationSecretFromCli({
          secretArg,
          stdin: opts.stdin,
        });
        await saveTunnelRegistrationSecret(ctx, secret);
        console.log(`Saved tunnel registration secret to ${ctx.configPath}.`);
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        log.error({ err, phase: 'tunnel_secret_set' }, `Tunnel secret set failed: ${em}`);
        console.error(em);
        process.exit(1);
      }
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
    .option(
      '--release',
      'Deregister from broker and clear saved subdomain (next start gets a new public URL)',
    )
    .option('--yes', 'Skip confirmation when using --release')
    .action(async (opts: { release?: boolean; yes?: boolean }) => {
      configureTunnel(ctx);
      if (opts.release) {
        if (!opts.yes && isInteractive()) {
          const { confirm } = await import('@inquirer/prompts');
          const ok = await confirm({
            message:
              'Release will revoke the public URL and subdomain on the broker. Continue?',
            default: false,
          });
          if (!ok) {
            console.log('Cancelled.');
            return;
          }
        }
      }
      const { released } = await getTunnelService().stop({ release: opts.release });
      const config = loadConfig(ctx.configPath);
      setTunnelEnabledInConfig(config, false);
      await saveConfig(config, ctx.configPath);
      console.log(released ? 'Tunnel stopped and broker registration released.' : 'Tunnel stopped.');
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
    .action(async () => {
      configureTunnel(ctx);
      const config = loadConfig(ctx.configPath);
      const { port, host } = resolveGatewayPortHost(config);
      const qr = await getTunnelService().buildQr(port, host);
      if (!qr.qrPayload) {
        console.error('No active tunnel. Run: xopc tunnel start');
        process.exit(1);
      }
      console.log(qr.qrPayload);
    });

  cmd
    .command('broker')
    .description('Self-hosted FRP broker helpers')
    .addCommand(
      new Command('init')
        .description('Print a starter frps + broker configuration template')
        .option('--domain <domain>', 'Public domain for frps', 'tunnel.example.com')
        .action((opts) => {
          const domain = String(opts.domain ?? 'tunnel.example.com');
          console.log(`# Self-hosted FRP broker sketch for ${domain}`);
          console.log('# 1. Run frps with vhost HTTP/HTTPS and a registration token');
          console.log(`# 2. Point tunnel.brokerUrl to https://${domain}/api`);
          console.log('# 3. Save the broker registration key as tunnel.registrationSecret');
          console.log('');
          console.log(JSON.stringify({
            frps: {
              bindPort: 7000,
              vhostHTTPPort: 8080,
              subdomainHost: domain,
            },
            broker: {
              apiUrl: `https://${domain}/api`,
              registrationSecretConfig: 'tunnel.registrationSecret',
            },
          }, null, 2));
        }),
    );

  return cmd;
}

register({
  id: 'tunnel',
  name: 'tunnel',
  description: 'FRP remote access tunnel',
  factory: createTunnelCommand,
  metadata: {
    category: 'runtime',
    examples: ['xopc tunnel start', 'xopc tunnel status', 'xopc tunnel secret set'],
  },
});
