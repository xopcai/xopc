import { Command } from 'commander';

import { loadConfig } from '../../../config/index.js';
import { resolveConfigPath } from '../../../config/paths.js';
import { getContextWithOpts } from '../../index.js';
import { acquireGatewayLock, GatewayLockError } from '../../../gateway/lock.js';
import {
  callGatewayApi,
  addGatewayClientOptions,
  parseGatewayClientOptions,
  resolveGatewayUrl,
} from '../../utils/gateway-client.js';

interface StatusResponse {
  status: string;
  version?: string;
  channels?: Record<string, { status: string }>;
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

export function createStatusCommand(): Command {
  const cmd = new Command('status').description('Check gateway status with connectivity probe');

  addGatewayClientOptions(cmd);
  cmd.option('--no-probe', 'Skip HTTP probe (only check lock file)');

  cmd.action(async (options) => {
    const ctx = getContextWithOpts();
    const configPath = ctx.configPath || resolveConfigPath();
    const config = loadConfig(configPath);
    const port = config?.gateway?.port ?? 18790;
    const clientOpts = { ...parseGatewayClientOptions(options as Record<string, unknown>), configPath };
    const gatewayUrl = resolveGatewayUrl({ url: clientOpts.url, configPath });

    let lockAlive = false;
    let lockPid: number | undefined;

    try {
      const lock = await acquireGatewayLock(configPath, { timeoutMs: 100, port });
      await lock.release();
      lockAlive = false;
    } catch (err) {
      if (err instanceof GatewayLockError) {
        lockAlive = true;
        const pidMatch = err.message.match(/pid\s+(\d+)/);
        if (pidMatch) lockPid = parseInt(pidMatch[1], 10);
      } else {
        console.error('❌ Failed to check status:', err);
        process.exit(1);
      }
    }

    const optsProbe = options as { probe?: boolean };
    const shouldProbe = optsProbe.probe !== false;

    let probeResult: {
      ok: boolean;
      data?: StatusResponse;
      error?: string;
      durationMs: number;
    } | null = null;

    if (shouldProbe) {
      const healthProbe = await callGatewayApi<{ status: string }>('GET', '/api/health', {
        ...clientOpts,
        timeoutMs: clientOpts.timeoutMs ?? 5000,
      });

      if (healthProbe.ok) {
        const statusProbe = await callGatewayApi<StatusResponse>('GET', '/api/status', clientOpts);
        probeResult = statusProbe.ok
          ? statusProbe
          : { ok: true, durationMs: healthProbe.durationMs, data: { status: 'ok' } };
      } else {
        probeResult = { ok: false, error: healthProbe.error, durationMs: healthProbe.durationMs };
      }
    }

    if (clientOpts.json) {
      console.log(
        JSON.stringify(
          {
            running: lockAlive || (probeResult?.ok ?? false),
            lock: { alive: lockAlive, pid: lockPid },
            probe: probeResult
              ? {
                  reachable: probeResult.ok,
                  durationMs: probeResult.durationMs,
                  ...(probeResult.data ?? {}),
                  ...(probeResult.error ? { error: probeResult.error } : {}),
                }
              : null,
            url: gatewayUrl,
            port,
          },
          null,
          2,
        ),
      );
      process.exit(probeResult?.ok || lockAlive ? 0 : 1);
    }

    const isRunning = lockAlive || (probeResult?.ok ?? false);

    if (!isRunning) {
      console.log('⚠️  Gateway is not running');
      if (probeResult && !probeResult.ok) {
        console.log(`   Probe: ${probeResult.error} (${probeResult.durationMs}ms)`);
      }
      console.log('');
      console.log('💡 Start with: xopc gateway');
      process.exit(1);
    }

    console.log('✅ Gateway is running');
    console.log(`   URL:  ${gatewayUrl}`);
    console.log(`   Port: ${port}`);
    if (lockPid) {
      console.log(`   PID:  ${lockPid}`);
    }

    if (probeResult?.ok && probeResult.data) {
      const data = probeResult.data;
      console.log(`   Probe: OK (${probeResult.durationMs}ms)`);
      if (data.version) console.log(`   Version: ${data.version}`);
      if (data.uptime != null) console.log(`   Uptime: ${formatUptime(data.uptime)}`);

      if (data.channels && Object.keys(data.channels).length > 0) {
        console.log('');
        console.log('📡 Channels:');
        for (const [name, info] of Object.entries(data.channels)) {
          const icon = info.status === 'connected' ? '✅' : info.status === 'disabled' ? '⚪' : '❌';
          console.log(`   ${icon} ${name}: ${info.status}`);
        }
      }
    } else if (probeResult && !probeResult.ok) {
      console.log(`   Probe: Failed (${probeResult.error})`);
    } else if (!shouldProbe) {
      console.log('   Probe: skipped (--no-probe)');
    }

    const token = config?.gateway?.auth?.token;
    if (token) {
      console.log('');
      console.log(`🔑 Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
    }

    console.log('');
    console.log('📝 Management:');
    console.log('   xopc gateway stop      # Stop gateway');
    console.log('   xopc gateway restart   # Restart gateway');
    console.log('   xopc gateway health    # Detailed health check');
    process.exit(0);
  });

  return cmd;
}
