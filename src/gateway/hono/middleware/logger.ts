import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

import { getClientIpFromHeaders } from '../../security/loopback.js';
import { resolveClientIpFromRequest } from '../../client-ip.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('Gateway:HTTP');

export interface LoggerMiddlewareConfig {
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
}

function resolveRemoteAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

function resolveRequestClientIp(c: Context, config?: LoggerMiddlewareConfig): string {
  const trustedProxies = config?.trustedProxies;
  if (trustedProxies?.length) {
    return resolveClientIpFromRequest({
      remoteAddress: resolveRemoteAddress(c),
      getHeader: (name) => c.req.header(name),
      trustedProxies,
      allowRealIpFallback: config?.allowRealIpFallback,
    });
  }
  return getClientIpFromHeaders({
    get: (name) => c.req.header(name) ?? undefined,
  });
}

export function logger(config?: LoggerMiddlewareConfig) {
  return createMiddleware(async (c, next) => {
    const start = Date.now();

    const clientIp = resolveRequestClientIp(c, config);
    const userAgent = c.req.header('user-agent') ?? undefined;
    const contentLength = c.req.header('content-length');
    const referer = c.req.header('referer') ?? undefined;

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;
    const isServerError = status >= 500;
    const isClientError = status >= 400 && status < 500;
    const isSlow = duration > 1000;

    const logData = {
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs: duration,
      clientIp,
      ...(userAgent ? { userAgent } : {}),
      ...(contentLength ? { contentLength: Number(contentLength) } : {}),
      ...(referer ? { referer } : {}),
    };

    const msg = `HTTP ${c.req.method} ${c.req.path} → ${status} (${duration}ms)`;

    if (isServerError || isSlow) {
      log.warn(logData, msg);
    } else if (isClientError) {
      // 4xx: info avoids doubling warn noise from auth / rate-limit handlers
      log.info(logData, msg);
    } else {
      log.debug(logData, msg);
    }
  });
}
