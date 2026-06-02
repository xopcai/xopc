import { loadConfig } from '../../../../config/loader.js';
import { existsSync } from 'node:fs';
import { resolveGatewayService } from '../../../../daemon/service.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkGatewayService(ctx: DoctorContext): Promise<CheckResult> {
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'gateway-service',
      label: 'Gateway service',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

  try {
    loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'gateway-service',
      label: 'Gateway service',
      status: 'skip',
      message: 'Config could not be loaded; skipped.',
      hints: [],
    };
  }

  let service;
  try {
    service = await resolveGatewayService();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id: 'gateway-service',
      label: 'Gateway service',
      status: 'skip',
      message: `Service backend unavailable: ${msg}`,
      hints: [],
    };
  }

  const env: Record<string, string | undefined> = { ...process.env };
  const loaded = await service.isLoaded({ env });
  if (!loaded) {
    return {
      id: 'gateway-service',
      label: 'Gateway service',
      status: 'warn',
      message: 'Gateway is not installed as a system service.',
      hints: ['Install: xopc gateway service install'],
    };
  }

  const runtime = await service.readRuntime(env);
  if (runtime.status === 'running' && runtime.pid) {
    return {
      id: 'gateway-service',
      label: 'Gateway service',
      status: 'pass',
      message: `Gateway service is running (PID ${runtime.pid}).`,
      hints: [service.label],
    };
  }

  return {
    id: 'gateway-service',
    label: 'Gateway service',
    status: 'warn',
    message: `Gateway service is installed but not running (status: ${runtime.status}).`,
    hints: ['Start: xopc gateway service start'],
  };
}
