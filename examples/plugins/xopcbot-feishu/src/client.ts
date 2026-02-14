/**
 * Feishu Client - SDK wrapper
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuDomain, FeishuConfig } from './types.js';

// Client cache for reuse
const clientCache = new Map<
  string,
  {
    client: Lark.Client;
    config: { appId: string; appSecret: string; domain?: FeishuDomain };
  }
>();

function resolveDomain(domain: FeishuDomain | undefined): Lark.Domain | string {
  if (domain === 'lark') return Lark.Domain.Lark;
  if (domain === 'feishu' || !domain) return Lark.Domain.Feishu;
  return domain.replace(/\/+$/, '');
}

export interface ClientCredentials {
  accountId?: string;
  appId?: string;
  appSecret?: string;
  domain?: FeishuDomain;
}

/**
 * Create or get cached Feishu client
 */
export function createFeishuClient(creds: ClientCredentials): Lark.Client {
  const { accountId = 'default', appId, appSecret, domain } = creds;

  if (!appId || !appSecret) {
    throw new Error(`Feishu credentials not configured for account "${accountId}"`);
  }

  // Check cache
  const cached = clientCache.get(accountId);
  if (
    cached &&
    cached.config.appId === appId &&
    cached.config.appSecret === appSecret &&
    cached.config.domain === domain
  ) {
    return cached.client;
  }

  // Create new client
  const client = new Lark.Client({
    appId,
    appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveDomain(domain),
  });

  clientCache.set(accountId, {
    client,
    config: { appId, appSecret, domain },
  });

  return client;
}

/**
 * Create WebSocket client for receiving events
 */
export function createFeishuWSClient(config: FeishuConfig): Lark.WSClient {
  if (!config.appId || !config.appSecret) {
    throw new Error('Feishu appId and appSecret are required');
  }

  return new Lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: resolveDomain(config.domain),
    loggerLevel: Lark.LoggerLevel.info,
  });
}

/**
 * Create event dispatcher for webhook/verification
 */
export function createEventDispatcher(config: FeishuConfig): Lark.EventDispatcher {
  return new Lark.EventDispatcher({
    encryptKey: undefined, // WebSocket mode doesn't need this
    verificationToken: undefined,
  });
}

/**
 * Clear client cache
 */
export function clearClientCache(accountId?: string): void {
  if (accountId) {
    clientCache.delete(accountId);
  } else {
    clientCache.clear();
  }
}

/**
 * Get cached client
 */
export function getFeishuClient(accountId: string): Lark.Client | null {
  return clientCache.get(accountId)?.client ?? null;
}
