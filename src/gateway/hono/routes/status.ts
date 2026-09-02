import { createHash } from 'node:crypto';

import type { Context } from 'hono';
import type { Hono } from 'hono';

import type { Config } from '../../../config/schema.js';
import { getGatewayAgentEffectiveConfig } from '../../agents-admin.js';
import { isSTTAvailable, mergeSttConfigFromAppConfig } from '../../../voice/stt/index.js';
import { getDefaultModelSync, resolveModel } from '../../../providers/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

export function buildEvalRuntimeIdentity(
  service: AuthenticatedRouteDeps['service'],
  agentId: string,
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string; status: number } {
  const config = service.currentConfig as Config | undefined;
  if (!config) return { ok: false, error: 'Gateway configuration is unavailable', status: 503 };
  const effective = getGatewayAgentEffectiveConfig(config, agentId);
  if ('error' in effective) {
    return {
      ok: false,
      error: effective.error,
      status: effective.status ?? 400,
    };
  }

  const agentConfig = effective.data.config;
  return {
    ok: true,
    payload: {
      schemaVersion: 1,
      version: service.getHealth().version,
      buildCommit:
        process.env.XOPC_BUILD_COMMIT?.trim() ||
        process.env.GITHUB_SHA?.trim() ||
        null,
      agentId,
      modelRef: agentConfig.models.chat.primary,
      thinkingLevel: null,
      configHash: contentHash(agentConfig),
      toolPolicyHash: contentHash(agentConfig.tools),
      skillPolicyHash: contentHash(agentConfig.skills),
      sources: effective.data.sources,
    },
  };
}

function isRefineAvailable(config: Config | undefined): boolean {
  if (!config) return false;
  for (const candidate of [
    process.env.XOPC_VOICE_REFINE_MODEL?.trim(),
    'openai/gpt-5.6-luna',
    'google/gemini-3.5-flash',
  ]) {
    if (!candidate) continue;
    try {
      resolveModel(candidate);
      return true;
    } catch { /* next */ }
  }
  try {
    resolveModel(getDefaultModelSync(config));
    return true;
  } catch {
    return false;
  }
}

function buildStatusPayload(service: AuthenticatedRouteDeps['service']) {
  const health = service.getHealth();
  const rows = service.getChannelsStatus();
  const channels: Record<string, { status: string }> = {};
  for (const row of rows) {
    const status = !row.enabled ? 'disabled' : row.connected ? 'connected' : 'disconnected';
    channels[row.name] = { status };
  }

  const config = service.currentConfig as Config | undefined;
  const sttConfig = config
    ? mergeSttConfigFromAppConfig(config.tools?.media?.audio, config.tools?.media)
    : undefined;

  return {
    status: health.status,
    version: health.version,
    channels,
    uptime: health.uptime,
    voice: {
      sttAvailable: sttConfig ? isSTTAvailable(sttConfig) : false,
      sttEnabled: sttConfig?.enabled === true,
      sttProvider: sttConfig?.provider ?? null,
      localModelId:
        sttConfig?.provider === 'xopc-local' &&
        typeof sttConfig.providers?.['xopc-local']?.model === 'string'
          ? sttConfig.providers['xopc-local'].model
          : null,
      refineAvailable: isRefineAvailable(config),
    },
  };
}

export function registerStatusRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  const handler = (c: Context) => c.json(buildStatusPayload(service));

  authenticated.get('/status', handler);
  authenticated.get('/api/status', handler);
  authenticated.get('/api/eval/runtime-identity', (c) => {
    const agentId = c.req.query('agentId')?.trim();
    if (!agentId) return c.json({ ok: false, error: 'agentId is required' }, 400);
    const result = buildEvalRuntimeIdentity(service, agentId);
    if ('error' in result) {
      const status = result.status === 404 ? 404 : result.status === 503 ? 503 : 400;
      return c.json({ ok: false, error: result.error }, status);
    }
    return c.json(result);
  });

  /**
   * POST /api/gateway/restart — respawn gateway process when supported (foreground `xopc gateway`).
   */
  authenticated.post('/api/gateway/restart', strictRateLimitMiddleware, (c) => {
    const result = service.triggerGatewayProcessRestart();
    if (!result.ok) {
      return c.json({ ok: false, error: result.mode, message: result.message ?? 'Restart failed' }, 400);
    }
    return c.json({ ok: true, payload: { mode: result.mode } });
  });
}
