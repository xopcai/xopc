/**
 * `PATCH /api/config` — `body.gateway.*` section.
 *
 * Covers heartbeat, bind/customBindHost/port, tailscale, auth (mode + token +
 * password + rateLimit + trustedProxy), trustedProxies, allowRealIpFallback,
 * dangerouslyAllowHostHeaderOriginFallback, security, share, corsOrigins,
 * maxSseConnections, and channelConnectDefer{Mode,Ids,SkipIds}.
 *
 * Validation policy: each subsection that can reject rejects with a 400 and a
 * specific `message`. The dispatcher converts these into `c.json(...)`.
 *
 * Initial-state branches use the same literal defaults the inline code did
 * (loopback + port 18790 + 1800s heartbeat + 100 SSE conn + empty CORS) so
 * a brand-new install gets a working gateway after the first PATCH.
 */
import type { Config, GatewayBindMode } from '../../../../config/schema.js';
import { isValidIPv4 } from '../../../../config/gateway-bind.js';
import { mergeShareConfigPatch } from '../../../../share/share-config.js';
import { type PatchResult, PATCH_OK, patchError } from './result.js';

/**
 * Shared default for "user PATCH'd a gateway subsection but `config.gateway`
 * was never initialised". Identical to the inline literal repeated in the
 * pre-extraction handler so this is behavior-preserving.
 */
function ensureGateway(config: Config): NonNullable<Config['gateway']> {
  if (!config.gateway) {
    config.gateway = {
      bind: 'loopback',
      port: 18790,
      heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
      maxSseConnections: 100,
      corsOrigins: [],
    };
  }
  return config.gateway;
}

function parseDeferIdList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim());
  if (ids.length > 24) return null;
  return ids;
}

export function applyGatewayPatch(config: Config, body: any): PatchResult {
  if (body.gateway?.heartbeat !== undefined && typeof body.gateway.heartbeat === 'object') {
    const gw = ensureGateway(config);
    if (!gw.heartbeat) {
      gw.heartbeat = { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false };
    }
    const h = gw.heartbeat;
    const p = body.gateway.heartbeat as Record<string, unknown>;
    if (p.enabled !== undefined) h.enabled = Boolean(p.enabled);
    if (p.intervalMs !== undefined && typeof p.intervalMs === 'number' && Number.isFinite(p.intervalMs)) {
      h.intervalMs = p.intervalMs;
    }
    if (p.includeSystemPromptSection !== undefined) {
      h.includeSystemPromptSection = Boolean(p.includeSystemPromptSection);
    }
    if (p.target !== undefined) {
      if (p.target === null || p.target === '') delete (h as { target?: string }).target;
      else (h as { target?: string }).target = String(p.target);
    }
    if (p.targetChatId !== undefined) {
      if (p.targetChatId === null || p.targetChatId === '') delete (h as { targetChatId?: string }).targetChatId;
      else (h as { targetChatId?: string }).targetChatId = String(p.targetChatId);
    }
    if (p.prompt !== undefined) {
      if (p.prompt === null || p.prompt === '') delete (h as { prompt?: string }).prompt;
      else (h as { prompt?: string }).prompt = String(p.prompt);
    }
    if (p.ackMaxChars !== undefined) {
      if (p.ackMaxChars === null || p.ackMaxChars === '') delete (h as { ackMaxChars?: number }).ackMaxChars;
      else if (typeof p.ackMaxChars === 'number' && Number.isFinite(p.ackMaxChars)) {
        (h as { ackMaxChars?: number }).ackMaxChars = p.ackMaxChars;
      }
    }
    if (p.isolatedSession !== undefined) {
      if (p.isolatedSession === null || p.isolatedSession === false) {
        delete (h as { isolatedSession?: boolean }).isolatedSession;
      } else {
        (h as { isolatedSession?: boolean }).isolatedSession = Boolean(p.isolatedSession);
      }
    }
    if (p.activeHours !== undefined) {
      if (p.activeHours === null) {
        delete (h as { activeHours?: unknown }).activeHours;
      } else if (typeof p.activeHours === 'object' && p.activeHours !== null) {
        const ah = p.activeHours as Record<string, unknown>;
        const start = typeof ah.start === 'string' ? ah.start : '';
        const end = typeof ah.end === 'string' ? ah.end : '';
        if (start && end) {
          (h as { activeHours?: { start: string; end: string; timezone?: string } }).activeHours = {
            start,
            end,
            ...(typeof ah.timezone === 'string' && ah.timezone.trim() ? { timezone: ah.timezone } : {}),
          };
        } else {
          delete (h as { activeHours?: unknown }).activeHours;
        }
      }
    }
  }

  if (body.gateway?.bind !== undefined) {
    const bindModes = new Set(['auto', 'loopback', 'lan', 'tailnet', 'custom']);
    const bind = body.gateway.bind;
    if (typeof bind !== 'string' || !bindModes.has(bind)) {
      return patchError('gateway.bind must be one of: auto, loopback, lan, tailnet, custom');
    }
    if (!config.gateway) {
      config.gateway = {
        bind: bind as GatewayBindMode,
        port: 18790,
        heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
        maxSseConnections: 100,
        corsOrigins: [],
      };
    } else {
      config.gateway.bind = bind as GatewayBindMode;
    }
    if (bind !== 'custom') {
      delete config.gateway.customBindHost;
    }
  }

  if (body.gateway?.customBindHost !== undefined) {
    if (body.gateway.customBindHost === null || body.gateway.customBindHost === '') {
      if (config.gateway) {
        delete config.gateway.customBindHost;
      }
    } else if (typeof body.gateway.customBindHost !== 'string' || !isValidIPv4(body.gateway.customBindHost.trim())) {
      return patchError('gateway.customBindHost must be a valid IPv4 address');
    } else if (config.gateway) {
      config.gateway.customBindHost = body.gateway.customBindHost.trim();
      config.gateway.bind = 'custom';
    }
  }

  if (body.gateway?.port !== undefined) {
    if (
      typeof body.gateway.port !== 'number' ||
      !Number.isFinite(body.gateway.port) ||
      body.gateway.port < 1 ||
      body.gateway.port > 65535
    ) {
      return patchError('gateway.port must be an integer from 1 to 65535');
    }
    if (!config.gateway) {
      config.gateway = {
        bind: 'loopback',
        port: Math.floor(body.gateway.port),
        heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
        maxSseConnections: 100,
        corsOrigins: [],
      };
    } else {
      config.gateway.port = Math.floor(body.gateway.port);
    }
  }

  if (body.gateway?.tailscale !== undefined && typeof body.gateway.tailscale === 'object') {
    const ts = body.gateway.tailscale as Record<string, unknown>;
    if (!config.gateway) {
      config.gateway = {
        bind: 'loopback',
        port: 18790,
        auth: { mode: 'token' },
        heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
        maxSseConnections: 100,
        corsOrigins: [],
      };
    }
    config.gateway.tailscale = {
      ...(config.gateway.tailscale ?? { mode: 'off', resetOnExit: true }),
    };
    if (ts.mode !== undefined) {
      if (ts.mode !== 'off' && ts.mode !== 'serve' && ts.mode !== 'funnel') {
        return patchError('gateway.tailscale.mode must be off, serve, or funnel');
      }
      config.gateway.tailscale.mode = ts.mode as 'off' | 'serve' | 'funnel';
    }
    if (ts.resetOnExit !== undefined) {
      config.gateway.tailscale.resetOnExit = ts.resetOnExit === true;
    }
  }

  if (body.gateway?.auth !== undefined) {
    const gw = ensureGateway(config);
    if (!gw.auth) gw.auth = { mode: 'token' };
    const a = body.gateway.auth;
    if (a.mode !== undefined) {
      if (
        a.mode !== 'none' &&
        a.mode !== 'token' &&
        a.mode !== 'password' &&
        a.mode !== 'trusted-proxy'
      ) {
        return patchError('gateway.auth.mode must be none, token, password, or trusted-proxy');
      }
      gw.auth.mode = a.mode;
    }
    if (a.token !== undefined) {
      if (a.token === null || (typeof a.token === 'string' && !a.token.trim())) {
        delete gw.auth.token;
      } else if (typeof a.token === 'string') {
        gw.auth.token = a.token;
      }
    }
    if (a.password !== undefined) {
      if (a.password === null || (typeof a.password === 'string' && !a.password.trim())) {
        delete gw.auth.password;
      } else if (
        typeof a.password === 'string' &&
        a.password !== '***' &&
        a.password !== '••••••••••••'
      ) {
        gw.auth.password = a.password;
      }
    }
    if (a.rateLimit !== undefined && typeof a.rateLimit === 'object' && a.rateLimit !== null) {
      const rlIn = a.rateLimit as Record<string, unknown>;
      if (!gw.auth.rateLimit) {
        gw.auth.rateLimit = {
          enabled: true,
          maxAttempts: 5,
          windowMs: 900_000,
          blockDurationMs: 300_000,
          exemptLoopback: true,
        };
      }
      const rl = gw.auth.rateLimit!;
      if (rlIn.enabled !== undefined) rl.enabled = Boolean(rlIn.enabled);
      if (typeof rlIn.maxAttempts === 'number' && Number.isFinite(rlIn.maxAttempts)) {
        rl.maxAttempts = Math.max(1, Math.floor(rlIn.maxAttempts));
      }
      if (typeof rlIn.windowMs === 'number' && Number.isFinite(rlIn.windowMs) && rlIn.windowMs > 0) {
        rl.windowMs = Math.floor(rlIn.windowMs);
      }
      if (
        typeof rlIn.blockDurationMs === 'number' &&
        Number.isFinite(rlIn.blockDurationMs) &&
        rlIn.blockDurationMs > 0
      ) {
        rl.blockDurationMs = Math.floor(rlIn.blockDurationMs);
      }
      if (
        typeof rlIn.lockoutMs === 'number' &&
        Number.isFinite(rlIn.lockoutMs) &&
        rlIn.lockoutMs > 0
      ) {
        rl.blockDurationMs = Math.floor(rlIn.lockoutMs);
      }
      if (rlIn.exemptLoopback !== undefined) {
        rl.exemptLoopback = Boolean(rlIn.exemptLoopback);
      }
    }
    if (a.trustedProxy !== undefined) {
      if (a.trustedProxy === null) {
        delete gw.auth.trustedProxy;
      } else if (typeof a.trustedProxy === 'object' && a.trustedProxy !== null) {
        const tpIn = a.trustedProxy as Record<string, unknown>;
        const userHeader =
          typeof tpIn.userHeader === 'string' ? tpIn.userHeader.trim() : '';
        if (!userHeader) {
          return patchError('gateway.auth.trustedProxy.userHeader is required');
        }
        const trustedProxy: NonNullable<(typeof gw.auth)['trustedProxy']> = {
          userHeader,
        };
        if (tpIn.requiredHeaders !== undefined) {
          if (!Array.isArray(tpIn.requiredHeaders)) {
            return patchError('gateway.auth.trustedProxy.requiredHeaders must be an array');
          }
          trustedProxy.requiredHeaders = tpIn.requiredHeaders
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .map((x) => x.trim());
        }
        if (tpIn.allowUsers !== undefined) {
          if (!Array.isArray(tpIn.allowUsers)) {
            return patchError('gateway.auth.trustedProxy.allowUsers must be an array');
          }
          trustedProxy.allowUsers = tpIn.allowUsers
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .map((x) => x.trim());
        }
        if (tpIn.allowLoopback !== undefined) {
          trustedProxy.allowLoopback = Boolean(tpIn.allowLoopback);
        }
        gw.auth.trustedProxy = trustedProxy;
      }
    }
  }

  if (body.gateway?.trustedProxies !== undefined) {
    if (!Array.isArray(body.gateway.trustedProxies)) {
      return patchError('gateway.trustedProxies must be an array');
    }
    const gw = ensureGateway(config);
    gw.trustedProxies = body.gateway.trustedProxies
      .filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x: string) => x.trim());
  }

  if (body.gateway?.allowRealIpFallback !== undefined) {
    const gw = ensureGateway(config);
    gw.allowRealIpFallback = Boolean(body.gateway.allowRealIpFallback);
  }

  if (body.gateway?.dangerouslyAllowHostHeaderOriginFallback !== undefined) {
    const gw = ensureGateway(config);
    gw.dangerouslyAllowHostHeaderOriginFallback = Boolean(
      body.gateway.dangerouslyAllowHostHeaderOriginFallback,
    );
  }

  if (body.gateway?.security !== undefined) {
    if (typeof body.gateway.security !== 'object' || body.gateway.security === null) {
      return patchError('gateway.security must be an object');
    }
    const gw = ensureGateway(config);
    const secIn = body.gateway.security as Record<string, unknown>;
    if (!gw.security) {
      gw.security = {};
    }
    if (secIn.strict !== undefined) {
      gw.security.strict = Boolean(secIn.strict);
    }
  }

  if (body.gateway?.share !== undefined) {
    if (typeof body.gateway.share !== 'object' || body.gateway.share === null || Array.isArray(body.gateway.share)) {
      return patchError('gateway.share must be an object');
    }
    const shareResult = mergeShareConfigPatch(config, body.gateway.share as Record<string, unknown>);
    if (shareResult.ok === false) {
      return patchError(shareResult.message);
    }
  }

  if (body.gateway?.corsOrigins !== undefined) {
    if (!Array.isArray(body.gateway.corsOrigins)) {
      return patchError('gateway.corsOrigins must be an array');
    }
    const gw = ensureGateway(config);
    gw.corsOrigins = body.gateway.corsOrigins
      .filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x: string) => x.trim());
  }

  if (body.gateway?.maxSseConnections !== undefined) {
    if (
      typeof body.gateway.maxSseConnections !== 'number' ||
      !Number.isFinite(body.gateway.maxSseConnections) ||
      body.gateway.maxSseConnections < 1
    ) {
      return patchError('gateway.maxSseConnections must be a positive integer');
    }
    if (!config.gateway) {
      config.gateway = {
        bind: 'loopback',
        port: 18790,
        heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
        maxSseConnections: Math.floor(body.gateway.maxSseConnections),
        corsOrigins: [],
      };
    } else {
      config.gateway.maxSseConnections = Math.floor(body.gateway.maxSseConnections);
    }
  }

  if (body.gateway?.channelConnectDeferMode !== undefined) {
    const mode = body.gateway.channelConnectDeferMode;
    if (mode !== 'auto' && mode !== 'off' && mode !== 'explicit') {
      return patchError('gateway.channelConnectDeferMode must be auto, off, or explicit');
    }
    const gw = ensureGateway(config);
    gw.channelConnectDeferMode = mode;
  }

  if (body.gateway?.channelConnectDeferIds !== undefined) {
    const ids = parseDeferIdList(body.gateway.channelConnectDeferIds);
    if (ids === null) {
      return patchError('gateway.channelConnectDeferIds must be an array of up to 24 strings');
    }
    const gw = ensureGateway(config);
    gw.channelConnectDeferIds = ids;
  }

  if (body.gateway?.channelConnectDeferSkipIds !== undefined) {
    const ids = parseDeferIdList(body.gateway.channelConnectDeferSkipIds);
    if (ids === null) {
      return patchError('gateway.channelConnectDeferSkipIds must be an array of up to 24 strings');
    }
    const gw = ensureGateway(config);
    gw.channelConnectDeferSkipIds = ids;
  }

  return PATCH_OK;
}
