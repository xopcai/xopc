import { Command } from 'commander';

import { resolveConfigPath } from '../../../config/paths.js';
import { getContextWithOpts } from '../../index.js';
import {
  addGatewayClientOptions,
  parseGatewayClientOptions,
} from '../../utils/gateway-client-options.js';

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
  const cmd = new Command('status').description('Check gateway status (service + connectivity)');

  addGatewayClientOptions(cmd);
  cmd.option('--no-probe', 'Skip HTTP probe (only check service/lock)');

  cmd.action(async (options) => {
    const ctx = getContextWithOpts();
    const configPath = ctx.configPath || resolveConfigPath();
    const [
      { loadConfig },
      { acquireGatewayLock, GatewayLockError },
      { callGatewayApi, resolveGatewayUrl },
      { resolveGatewayService, isDaemonAvailableAsync, getPlatformName },
    ] = await Promise.all([
      import('../../../config/index.js'),
      import('../../../gateway/lock.js'),
      import('../../utils/gateway-client.js'),
      import('../../../daemon/service.js'),
    ]);
    const config = loadConfig(configPath);
    const port = config?.gateway?.port ?? 18790;
    const clientOpts = { ...parseGatewayClientOptions(options as Record<string, unknown>), configPath };
    const gatewayUrl = resolveGatewayUrl({ url: clientOpts.url, configPath });

    // ─── Service Status ───
    let serviceLoaded = false;
    let serviceRuntime: { status: string; pid?: number; lastExitStatus?: number } | null = null;
    let serviceVersion: string | undefined;

    const daemonAvailable = await isDaemonAvailableAsync();
    if (daemonAvailable) {
      try {
        const service = await resolveGatewayService();
        serviceLoaded = await service.isLoaded({ env: process.env });
        if (serviceLoaded) {
          serviceRuntime = await service.readRuntime();
          const command = await service.readCommand();
          serviceVersion = command?.environment?.XOPC_SERVICE_VERSION;
        }
      } catch {
        // Best-effort service check
      }
    }

    // ─── Lock Check ───
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

    // ─── HTTP Probe ───
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

    // ─── JSON Output ───
    if (clientOpts.json) {
      console.log(
        JSON.stringify(
          {
            running: lockAlive || (probeResult?.ok ?? false),
            service: daemonAvailable
              ? {
                  platform: getPlatformName(),
                  loaded: serviceLoaded,
                  runtime: serviceRuntime,
                  version: serviceVersion,
                }
              : null,
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

    // ─── Human Output ───
    const isRunning = lockAlive || (probeResult?.ok ?? false) || serviceRuntime?.status === 'running';

    if (!isRunning) {
      console.log('⚠️  Gateway is not running');
      if (daemonAvailable) {
        console.log(`   Service: ${serviceLoaded ? 'installed (not running)' : 'not installed'}`);
      }
      if (probeResult && !probeResult.ok) {
        console.log(`   Probe: ${probeResult.error} (${probeResult.durationMs}ms)`);
      }
      console.log('');
      console.log('💡 Start with: xopc gateway');
      if (!serviceLoaded && daemonAvailable) {
        console.log('   Or install service: xopc gateway service install');
      }
      process.exit(1);
    }

    console.log('Gateway Status');
    console.log('');

    // Service info
    if (daemonAvailable && serviceLoaded) {
      const runtimeStatus = serviceRuntime?.status ?? 'unknown';
      const pid = serviceRuntime?.pid || lockPid;
      console.log(`  Service:  ${getPlatformName()} (loaded)`);
      console.log(`  Runtime:  ${runtimeStatus}${pid ? ` (pid ${pid})` : ''}`);
    } else if (lockPid) {
      console.log(`  PID:      ${lockPid}`);
    }

    console.log(`  Port:     ${port}`);
    console.log(`  URL:      ${gatewayUrl}`);

    // Version from service or probe
    const version = probeResult?.data?.version || serviceVersion;
    if (version) {
      console.log(`  Version:  ${version}`);
    }

    // Uptime from probe
    if (probeResult?.ok && probeResult.data?.uptime != null) {
      console.log(`  Uptime:   ${formatUptime(probeResult.data.uptime)}`);
    }

    // Probe result
    if (probeResult?.ok) {
      console.log(`  Probe:    OK (${probeResult.durationMs}ms)`);
    } else if (probeResult && !probeResult.ok) {
      console.log(`  Probe:    Failed (${probeResult.error})`);
    } else if (!shouldProbe) {
      console.log('  Probe:    skipped');
    }

    // Token
    const token = config?.gateway?.auth?.token;
    if (token) {
      console.log(`  Token:    configured ✓`);
    }

    // Channels
    if (probeResult?.ok && probeResult.data?.channels) {
      const channels = probeResult.data.channels;
      if (Object.keys(channels).length > 0) {
        console.log('');
        console.log('Channels:');
        for (const [name, info] of Object.entries(channels)) {
          const icon = info.status === 'connected' ? '✅' : info.status === 'disabled' ? '⚪' : '❌';
          console.log(`  ${icon} ${name}: ${info.status}`);
        }
      }
    }

    process.exit(0);
  });

  return cmd;
}
