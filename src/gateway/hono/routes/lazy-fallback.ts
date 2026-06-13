import { Hono, type Context } from 'hono';

import type { GatewayService } from '../../service.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import {
  APP_LAZY_ROUTE_BUNDLES,
  AUTHENTICATED_LAZY_ROUTE_BUNDLES,
  findAuthenticatedLazyRouteBundle,
} from './lazy-bundles.js';
import { createGatewayRouteLogger, logRouteError } from '../lib/route-logger.js';

const log = createGatewayRouteLogger('LazyRoutes');

const authenticatedSubApps = new Map<string, Hono>();
const appSubApps = new Map<string, Hono>();
const authenticatedLoadPromises = new Map<string, Promise<Hono>>();
const appLoadPromises = new Map<string, Promise<Hono>>();

export function getLoadedLazyRouteBundleIdsForTests(): {
  authenticated: string[];
  app: string[];
} {
  return {
    authenticated: [...authenticatedSubApps.keys()],
    app: [...appSubApps.keys()],
  };
}

export function resetLazyRouteBundlesForTests(): void {
  authenticatedSubApps.clear();
  appSubApps.clear();
  authenticatedLoadPromises.clear();
  appLoadPromises.clear();
}

async function ensureAuthenticatedLazyBundle(
  bundleId: string,
  deps: AuthenticatedRouteDeps,
): Promise<Hono | null> {
  const existing = authenticatedSubApps.get(bundleId);
  if (existing) {
    return existing;
  }

  let pending = authenticatedLoadPromises.get(bundleId);
  if (!pending) {
    const bundle = AUTHENTICATED_LAZY_ROUTE_BUNDLES.find((entry) => entry.id === bundleId);
    if (!bundle) {
      return null;
    }
    pending = (async () => {
      const mod = await bundle.load();
      const sub = new Hono();
      mod.register(sub, deps);
      authenticatedSubApps.set(bundleId, sub);
      authenticatedLoadPromises.delete(bundleId);
      return sub;
    })();
    authenticatedLoadPromises.set(bundleId, pending);
  }

  return pending;
}

async function ensureAppLazyBundle(
  bundleId: string,
  params: { service: GatewayService; deps: AuthenticatedRouteDeps },
): Promise<Hono | null> {
  const existing = appSubApps.get(bundleId);
  if (existing) {
    return existing;
  }

  let pending = appLoadPromises.get(bundleId);
  if (!pending) {
    const bundle = APP_LAZY_ROUTE_BUNDLES.find((entry) => entry.id === bundleId);
    if (!bundle) {
      return null;
    }
    pending = (async () => {
      const mod = await bundle.load();
      const sub = new Hono();
      if (mod.registerOnApp) {
        mod.registerOnApp(sub, params.service);
      }
      appSubApps.set(bundleId, sub);
      appLoadPromises.delete(bundleId);
      return sub;
    })();
    appLoadPromises.set(bundleId, pending);
  }

  return pending;
}

async function forwardToSubApp(c: Context, sub: Hono): Promise<Response> {
  try {
    return await sub.fetch(c.req.raw, c.env, c.executionCtx);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ExecutionContext')) {
      return sub.fetch(c.req.raw, c.env);
    }
    logRouteError(log, c, error, 'gateway.route.lazy_forward');
    throw error;
  }
}

export function registerAuthenticatedLazyRouteFallback(
  authenticated: Hono,
  deps: AuthenticatedRouteDeps,
): void {
  authenticated.all('*', async (c) => {
    const bundle = findAuthenticatedLazyRouteBundle(c.req.path);
    if (!bundle) {
      return c.json({ error: 'Not found' }, 404);
    }
    const sub = await ensureAuthenticatedLazyBundle(bundle.id, deps);
    if (!sub) {
      return c.json({ error: 'Not found' }, 404);
    }
    return forwardToSubApp(c, sub);
  });
}

export function mountAppLazyRoutePrefixes(
  app: Hono,
  params: { service: GatewayService; deps: AuthenticatedRouteDeps },
): void {
  for (const bundle of APP_LAZY_ROUTE_BUNDLES) {
    const handler = async (c: Context) => {
      const sub = await ensureAppLazyBundle(bundle.id, params);
      if (!sub) {
        return c.json({ error: 'Not found' }, 404);
      }
      return forwardToSubApp(c, sub);
    };

    for (const prefix of bundle.prefixes) {
      app.all(prefix, handler);
      app.all(`${prefix}/*`, handler);
    }
  }
}
