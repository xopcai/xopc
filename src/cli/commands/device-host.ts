import { Command } from 'commander';

import { readDeviceHostConfig, startDeviceHost } from '../../endpoint-tools/device-host.js';
import { register } from '../registry.js';

register({ id: 'device-host', name: 'device-host', description: 'Publish device-local MCP capabilities to a Gateway',
  metadata: { category: 'runtime' }, factory: () => new Command('device-host')
    .description('Publish explicitly installed device-local MCP capabilities to a Gateway')
    .requiredOption('--host-config <path>', 'Device host JSON configuration; independent of Gateway MCP configuration')
    .option('--interactive', 'Ask locally before each confirmation-required invocation')
    .action(async (options: { hostConfig: string; interactive?: boolean }) => {
      if (options.interactive && !process.stdin.isTTY) throw new Error('Interactive approval requires a local terminal');
      let approvalQueue = Promise.resolve();
      const host = await startDeviceHost(await readDeviceHostConfig(options.hostConfig), {
        confirm: options.interactive ? request => {
          const decision = approvalQueue.then(async () => {
            request.signal.throwIfAborted();
            const { createInterface } = await import('node:readline/promises');
            const prompt = createInterface({ input: process.stdin, output: process.stderr });
            try {
              const answer = await prompt.question(`Allow ${JSON.stringify(request.descriptor.title)} (${request.descriptor.effect}) with arguments ${JSON.stringify(request.arguments).slice(0, 4000)}? [y/N] `, { signal: request.signal });
              return answer.trim().toLowerCase() === 'y';
            } finally { prompt.close(); }
          });
          approvalQueue = decision.then(() => {}, () => {});
          return decision;
        } : undefined,
        onError: providerId => { console.error(`Device provider ${providerId} became unavailable`); },
      });
      console.log(`Device host connected: ${host.principalId}`);
      let stop!: () => void;
      const stopped = new Promise<void>(resolve => { stop = resolve; });
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try { await stopped; } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await host.close(); }
    }),
});
