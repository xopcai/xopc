import { Command } from 'commander';

import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../context.js';

function createTailscaleCommand(_ctx: CLIContext): Command {
  return new Command('tailscale')
    .description('Tailscale status for gateway remote access')
    .addCommand(
      new Command('status')
        .description('Show tailnet IP, hostname, and Serve/Funnel state')
        .action(async () => {
          const {
            getTailnetIPv4,
            getTailnetHostname,
            isTailscaleInstalled,
          } = await import('../../infra/tailscale.js');
          const { getTailscaleExposureState } = await import('../../gateway/tailscale-lifecycle.js');

          const installed = await isTailscaleInstalled();
          if (!installed) {
            console.log('Tailscale: not installed or not found in PATH');
            process.exit(1);
          }

          const ip = await getTailnetIPv4();
          let hostname: string | null = null;
          try {
            hostname = await getTailnetHostname();
          } catch {
            hostname = null;
          }

          const exposure = getTailscaleExposureState();
          console.log('Tailscale');
          console.log(`  Tailnet IPv4: ${ip ?? '(unavailable)'}`);
          console.log(`  MagicDNS:     ${hostname ?? '(unavailable)'}`);
          console.log(`  Gateway exposure: ${exposure.mode}${exposure.active ? ' (active)' : ''}`);
          if (hostname && exposure.active) {
            console.log(`  URL: https://${hostname}/`);
          }
        }),
    )
    .addHelpText(
      'after',
      formatExamples(['xopc tailscale status']),
    );
}

register({
  id: 'tailscale',
  name: 'tailscale',
  description: 'Tailscale helpers for gateway exposure',
  factory: () => createTailscaleCommand(getContextWithOpts()),
  metadata: {
    category: 'runtime',
    examples: ['xopc tailscale status'],
  },
});

export default createTailscaleCommand;
