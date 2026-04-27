import { Command } from 'commander';

import { loadConfig } from '../../../config/index.js';
import { resolveConfigPath } from '../../../config/paths.js';
import {
  callGatewayApi,
  addGatewayClientOptions,
  parseGatewayClientOptions,
  resolveGatewayToken,
} from '../../utils/gateway-client.js';
import { getContextWithOpts } from '../../index.js';

interface ProbeTarget {
  label: string;
  url: string;
}

interface ProbeResultEntry {
  label: string;
  url: string;
  reachable: boolean;
  authenticated: boolean;
  durationMs: number;
  version?: string;
  error?: string;
}

function resolveProbeTargets(opts: { url?: string; port: number }): ProbeTarget[] {
  const targets: ProbeTarget[] = [];
  const port = opts.port;
  targets.push({ label: 'localhost', url: `http://127.0.0.1:${port}` });

  if (opts.url) {
    const normalized = opts.url.replace(/\/+$/, '');
    if (!normalized.includes('127.0.0.1') && !normalized.includes('localhost')) {
      targets.push({ label: 'remote', url: normalized });
    }
  }

  return targets;
}

async function probeTarget(
  target: ProbeTarget,
  token?: string,
  timeoutMs?: number,
): Promise<ProbeResultEntry> {
  const healthResult = await callGatewayApi<{ status: string; version?: string }>('GET', '/api/health', {
    url: target.url,
    timeoutMs: timeoutMs ?? 5000,
  });

  if (!healthResult.ok) {
    return {
      label: target.label,
      url: target.url,
      reachable: false,
      authenticated: false,
      durationMs: healthResult.durationMs,
      error: healthResult.error,
    };
  }

  let authenticated = false;
  if (token) {
    const statusResult = await callGatewayApi('GET', '/api/status', {
      url: target.url,
      token,
      timeoutMs: timeoutMs ?? 5000,
    });
    authenticated = statusResult.ok;
  }

  return {
    label: target.label,
    url: target.url,
    reachable: true,
    authenticated,
    durationMs: healthResult.durationMs,
    version: healthResult.data?.version,
  };
}

export function createProbeCommand(): Command {
  const cmd = new Command('probe').description('Probe gateway reachability and auth capability');

  addGatewayClientOptions(cmd);

  cmd.action(async (options) => {
    const ctx = getContextWithOpts();
    const configPath = ctx.configPath || resolveConfigPath();
    const config = loadConfig(configPath);
    const port = config?.gateway?.port ?? 18790;

    const clientOpts = { ...parseGatewayClientOptions(options as Record<string, unknown>), configPath };
    const token = resolveGatewayToken(clientOpts);
    const targets = resolveProbeTargets({ url: clientOpts.url, port });
    const results: ProbeResultEntry[] = [];

    for (const target of targets) {
      const result = await probeTarget(target, token, clientOpts.timeoutMs);
      results.push(result);
    }

    if (clientOpts.json) {
      console.log(JSON.stringify({ targets: results }, null, 2));
      const anyReachable = results.some((r) => r.reachable);
      process.exit(anyReachable ? 0 : 1);
    }

    console.log('🔍 Gateway Probe');
    console.log('');

    for (const result of results) {
      if (result.reachable) {
        console.log(`✅ ${result.label} (${result.url})`);
        console.log(`   Reachable: yes (${result.durationMs}ms)`);
        console.log(
          `   Auth: ${result.authenticated ? '✅ authenticated' : '🔒 not authenticated (pass --token)'}`,
        );
        if (result.version) {
          console.log(`   Version: ${result.version}`);
        }
      } else {
        console.log(`❌ ${result.label} (${result.url})`);
        console.log('   Reachable: no');
        console.log(`   Error: ${result.error}`);
      }
      console.log('');
    }

    const anyReachable = results.some((r) => r.reachable);
    if (!anyReachable) {
      console.log('💡 Is the gateway running? Try: xopc gateway');
    }
    process.exit(anyReachable ? 0 : 1);
  });

  return cmd;
}
