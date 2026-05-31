import { Command } from 'commander';

import {
  addGatewayClientOptions,
  parseGatewayClientOptions,
} from '../../utils/gateway-client-options.js';
import { getContextWithOpts } from '../../context.js';
import { resolveConfigPath } from '../../../config/paths.js';

interface HealthResponse {
  status: string;
  version?: string;
  uptime?: number;
}

interface StatusResponse {
  status: string;
  version?: string;
  channels?: Record<string, { status: string; accounts?: number }>;
  uptime?: number;
}

function formatUptime(seconds?: number): string {
  if (!seconds || seconds <= 0) return 'unknown';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

export function createHealthCommand(): Command {
  const cmd = new Command('health').description('Check gateway health and channel status');

  addGatewayClientOptions(cmd);

  cmd.action(async (options) => {
    const ctx = getContextWithOpts();
    const configPath = ctx.configPath || resolveConfigPath();
    const { callGatewayApi } = await import('../../utils/gateway-client.js');
    const clientOpts = { ...parseGatewayClientOptions(options as Record<string, unknown>), configPath };

    const healthResult = await callGatewayApi<HealthResponse>('GET', '/api/health', {
      ...clientOpts,
      timeoutMs: clientOpts.timeoutMs ?? 5000,
    });

    if (!healthResult.ok) {
      if (clientOpts.json) {
        console.log(
          JSON.stringify(
            {
              status: 'unreachable',
              error: healthResult.error,
              durationMs: healthResult.durationMs,
            },
            null,
            2,
          ),
        );
      } else {
        console.error(`❌ Gateway unreachable: ${healthResult.error}`);
        console.error('');
        console.error('💡 Is the gateway running? Try: xopc gateway');
      }
      process.exit(1);
    }

    const statusResult = await callGatewayApi<StatusResponse>('GET', '/api/status', clientOpts);

    if (clientOpts.json) {
      console.log(
        JSON.stringify(
          {
            status: 'ok',
            durationMs: healthResult.durationMs,
            health: healthResult.data,
            ...(statusResult.ok ? { details: statusResult.data } : {}),
          },
          null,
          2,
        ),
      );
      process.exit(0);
    }

    console.log(`✅ Gateway Health: OK (${healthResult.durationMs}ms)`);
    console.log('');

    if (healthResult.data?.version) {
      console.log(`   Version: ${healthResult.data.version}`);
    }
    if (healthResult.data?.uptime != null) {
      console.log(`   Uptime:  ${formatUptime(healthResult.data.uptime)}`);
    }

    if (statusResult.ok && statusResult.data?.channels) {
      console.log('');
      console.log('📡 Channels:');
      for (const [name, info] of Object.entries(statusResult.data.channels)) {
        const statusIcon = info.status === 'connected' ? '✅' : info.status === 'disabled' ? '⚪' : '❌';
        const accountsLabel = info.accounts != null ? ` (${info.accounts} account(s))` : '';
        console.log(`   ${statusIcon} ${name}: ${info.status}${accountsLabel}`);
      }
    } else if (statusResult.status === 401) {
      console.log('');
      console.log('🔒 Detailed status requires authentication. Pass --token <token>.');
    }

    process.exit(0);
  });

  return cmd;
}
