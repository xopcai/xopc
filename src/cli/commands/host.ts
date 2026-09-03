import { hostname } from 'node:os';

import { Command } from 'commander';

import { PACKAGE_VERSION } from '../../package-version.js';
import {
  ExecutionHostClient,
  ExecutionHostWorkspaceRuntime,
  createExecutionHostIdentity,
  loadExecutionHostIdentity,
  resolveExecutionHostStateDir,
} from '../../execution-hosts/index.js';
import { formatExamples, register } from '../registry.js';

function defaultCapabilities() {
  return { git: true, shell: true, search: true, patch: true, snapshots: true };
}

function normalizedGatewayUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Gateway URL must use http or https');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function createHostCommand(): Command {
  const command = new Command('host')
    .description('Enroll and run a remote execution host')
    .addHelpText('after', formatExamples([
      'xopc host enroll --gateway https://gateway.example --code <code>',
      'xopc host run --gateway https://gateway.example',
      'xopc host status',
    ]));

  command.command('enroll')
    .description('Enroll this machine with a gateway')
    .requiredOption('--gateway <url>', 'Gateway base URL')
    .requiredOption('--code <code>', 'One-time enrollment code')
    .option('--name <name>', 'Execution host display name', hostname())
    .option('--state-dir <path>', 'Execution host state directory')
    .option('--max-concurrency <count>', 'Maximum parallel operations', '2')
    .action(async (options: {
      gateway: string;
      code: string;
      name: string;
      stateDir?: string;
      maxConcurrency: string;
    }) => {
      const stateDir = options.stateDir || resolveExecutionHostStateDir();
      const maxConcurrency = Number.parseInt(options.maxConcurrency, 10);
      if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 64) {
        throw new Error('max-concurrency must be between 1 and 64');
      }
      let identity;
      try {
        identity = loadExecutionHostIdentity(stateDir);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') throw error;
        identity = createExecutionHostIdentity({
          stateDir,
          displayName: options.name,
          appVersion: PACKAGE_VERSION,
          capabilities: defaultCapabilities(),
          maxConcurrency,
        });
      }
      const gatewayUrl = normalizedGatewayUrl(options.gateway);
      const response = await fetch(new URL('/api/execution-hosts/enroll', `${gatewayUrl}/`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: options.code, registration: identity.registration }),
      });
      const body = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || `Enrollment failed (${response.status})`);
      console.log(`Execution host enrolled: ${identity.registration.displayName} (${identity.registration.hostId})`);
    });

  command.command('status')
    .description('Show the local execution host identity')
    .option('--state-dir <path>', 'Execution host state directory')
    .option('--json', 'Output JSON')
    .action((options: { stateDir?: string; json?: boolean }) => {
      const identity = loadExecutionHostIdentity(options.stateDir || resolveExecutionHostStateDir());
      const { publicKey: _publicKey, ...registration } = identity.registration;
      if (options.json) console.log(JSON.stringify(registration, null, 2));
      else console.log(`${registration.displayName} (${registration.hostId}) · ${registration.platform}/${registration.arch}`);
    });

  command.command('run')
    .description('Connect this execution host to its gateway')
    .requiredOption('--gateway <url>', 'Gateway base URL')
    .option('--state-dir <path>', 'Execution host state directory')
    .action(async (options: { gateway: string; stateDir?: string }) => {
      const stateDir = options.stateDir || resolveExecutionHostStateDir();
      const identity = loadExecutionHostIdentity(stateDir);
      const workspaceRuntime = new ExecutionHostWorkspaceRuntime(stateDir);
      const client = new ExecutionHostClient({
        gatewayUrl: normalizedGatewayUrl(options.gateway),
        identity,
        onStateChange: (state, error) => {
          if (state === 'connected') console.log(`Execution host connected: ${identity.registration.displayName}`);
          else if (state === 'error') console.error(`Execution host connection failed: ${error ?? 'unknown error'}`);
        },
        handler: workspaceRuntime,
      });
      client.connect();
      await new Promise<void>((resolve) => {
        const stop = () => {
          client.disconnect();
          resolve();
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
    });

  return command;
}

register({
  id: 'host',
  name: 'host',
  description: 'Enroll and run a remote execution host',
  factory: createHostCommand,
  metadata: { category: 'runtime' },
});
