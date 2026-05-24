import { Command } from 'commander';

import { startSshPortForward } from '../../infra/ssh-tunnel.js';
import { formatExamples, type CLIContext } from '../registry.js';

export function registerGatewaySshTunnelCommand(parent: Command, ctx: CLIContext): void {
  parent.addCommand(createGatewaySshTunnelCommand(ctx));
}

function createGatewaySshTunnelCommand(_ctx: CLIContext): Command {
  return new Command('ssh-tunnel')
    .description('Open an SSH local port forward to a remote gateway (loopback on the remote host)')
    .option('--target <user@host>', 'SSH target (required)')
    .option('--identity <path>', 'SSH identity file')
    .option('--local-port <number>', 'Local port to bind (default 18790)', '18790')
    .option('--remote-port <number>', 'Remote gateway port (default 18790)', '18790')
    .addHelpText(
      'after',
      formatExamples([
        'xopc gateway ssh-tunnel --target user@vps.example.com',
        'xopc gateway ssh-tunnel --target user@host --local-port 18790 --remote-port 18790',
      ]),
    )
    .action(async (options) => {
      const target = typeof options.target === 'string' ? options.target.trim() : '';
      if (!target) {
        console.error('Missing required --target user@host');
        process.exit(1);
      }

      const localPort = parseInt(String(options.localPort ?? '18790'), 10);
      const remotePort = parseInt(String(options.remotePort ?? '18790'), 10);
      if (!Number.isFinite(localPort) || !Number.isFinite(remotePort)) {
        console.error('Invalid --local-port or --remote-port');
        process.exit(1);
      }

      console.log(`Opening SSH tunnel localhost:${localPort} -> remote 127.0.0.1:${remotePort} via ${target}...`);

      let tunnel: Awaited<ReturnType<typeof startSshPortForward>>;
      try {
        tunnel = await startSshPortForward({
          target,
          identity: typeof options.identity === 'string' ? options.identity : undefined,
          localPortPreferred: localPort,
          remotePort,
        });
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        console.error(`SSH tunnel failed: ${em}`);
        process.exit(1);
      }

      console.log(`SSH tunnel active on http://127.0.0.1:${tunnel.localPort} (pid ${tunnel.pid ?? 'unknown'})`);
      console.log('Press Ctrl+C to close the tunnel');

      const shutdown = async () => {
        await tunnel.stop();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());

      await new Promise<void>(() => {
        // keep alive until signal
      });
    });
}
