import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { getCredentialResolver, type CredentialResolver } from '../auth/credentials.js';
import { resolveStateDir } from '../config/paths-state.js';
import { writeTextAtomicSync } from '../infra/write-file-atomic.js';
import { getModelCatalogStore, type ModelCatalogStore } from './model-catalog-store.js';
import { getModelRegistry } from './model-registry.js';

const DEFAULT_CONSOLE_URL = 'https://console.xopc.ai';
const DEFAULT_ROUTER_URL = 'https://router.xopc.ai/v1';
const CONNECTION_TTL_MS = 5 * 60_000;

interface PendingConnection {
  verifier: string;
  expiresAt: number;
}

interface CatalogModel {
  id: string;
  name: string;
  maxOutputTokens: number | null;
}

interface CatalogResult {
  models: CatalogModel[];
  recommendedModel: string | null;
  etag: string | null;
}

interface ConnectionToken {
  providerId: 'xopc-cloud';
  apiKey: string;
}

export interface XopcCloudConnectionOptions {
  fetchImpl?: typeof fetch;
  consoleUrl?: string;
  routerUrl?: string;
  deviceIdPath?: string;
  catalogStore?: ModelCatalogStore;
  credentials?: Pick<CredentialResolver, 'saveApiKey' | 'revealGatewayStoredApiKey' | 'deleteProfile'>;
  refreshModels?: () => void;
  now?: () => number;
}

export type XopcCloudPollResult =
  | { status: 'pending' }
  | { status: 'connected'; modelCount: number; models: string[]; recommendedModel: string | null };

export class XopcCloudHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'XopcCloudHttpError';
  }
}

function normalizedBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function parseJson<T>(value: unknown, message: string): T {
  if (!value || typeof value !== 'object') throw new Error(message);
  return value as T;
}

export class XopcCloudConnectionService {
  private readonly pending = new Map<string, PendingConnection>();
  private readonly fetchImpl: typeof fetch;
  private readonly consoleUrl: string;
  private readonly routerUrl: string;
  private readonly deviceIdPath: string;
  private readonly catalogStore: ModelCatalogStore;
  private readonly credentials: XopcCloudConnectionOptions['credentials'];
  private readonly refreshModels: () => void;
  private readonly now: () => number;

  constructor(options: XopcCloudConnectionOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.consoleUrl = normalizedBaseUrl(options.consoleUrl ?? process.env.XOPC_CONSOLE_URL ?? DEFAULT_CONSOLE_URL);
    this.routerUrl = normalizedBaseUrl(options.routerUrl ?? process.env.XOPC_MODEL_ROUTER_URL ?? DEFAULT_ROUTER_URL);
    this.deviceIdPath = options.deviceIdPath ?? join(resolveStateDir(), 'xopc-cloud-device.json');
    this.catalogStore = options.catalogStore ?? getModelCatalogStore();
    this.credentials = options.credentials ?? getCredentialResolver();
    this.refreshModels = options.refreshModels ?? (() => getModelRegistry().refresh());
    this.now = options.now ?? Date.now;
  }

  async start(clientType: 'electron' | 'web' | 'cli'): Promise<{
    requestId: string;
    authorizationUrl: string;
    expiresIn: number;
    pollInterval: number;
  }> {
    const verifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
    const response = await this.fetchImpl(`${this.consoleUrl}/api/v1/models/connect/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        codeChallenge,
        deviceId: this.getOrCreateDeviceId(),
        deviceName: hostname() || 'XOPC device',
        clientType,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = parseJson<{
      requestId?: unknown;
      authorizationUrl?: unknown;
      expiresIn?: unknown;
      pollInterval?: unknown;
    }>(await response.json().catch(() => null), 'XOPC Console returned an invalid response');
    if (!response.ok || typeof body.requestId !== 'string' || typeof body.authorizationUrl !== 'string') {
      throw new Error('Unable to start XOPC model connection');
    }
    const authorizationUrl = new URL(body.authorizationUrl);
    if (authorizationUrl.origin !== new URL(this.consoleUrl).origin) {
      throw new Error('XOPC Console returned an unsafe authorization URL');
    }
    const expiresIn = typeof body.expiresIn === 'number' ? body.expiresIn : CONNECTION_TTL_MS / 1000;
    this.pending.set(body.requestId, { verifier, expiresAt: this.now() + expiresIn * 1000 });
    return {
      requestId: body.requestId,
      authorizationUrl: authorizationUrl.href,
      expiresIn,
      pollInterval: typeof body.pollInterval === 'number' ? body.pollInterval : 2,
    };
  }

  async poll(requestId: string): Promise<XopcCloudPollResult> {
    const pending = this.pending.get(requestId);
    if (!pending) throw new Error('Connection request is not active');
    if (pending.expiresAt <= this.now()) {
      this.pending.delete(requestId);
      throw new Error('Connection request expired');
    }
    const tokenResponse = await this.fetchImpl(`${this.consoleUrl}/api/v1/models/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, codeVerifier: pending.verifier }),
      signal: AbortSignal.timeout(15_000),
    });
    if (tokenResponse.status === 202) return { status: 'pending' };
    const token = parseJson<Partial<ConnectionToken>>(
      await tokenResponse.json().catch(() => null),
      'XOPC Console returned an invalid token response',
    );
    if (!tokenResponse.ok || token.providerId !== 'xopc-cloud' || typeof token.apiKey !== 'string') {
      throw new Error('Unable to complete XOPC model connection');
    }

    const catalog = await this.fetchCatalog(token.apiKey);
    if (!catalog) throw new Error('XOPC model catalog was not available');
    await this.install(token.apiKey, catalog, true);
    this.pending.delete(requestId);
    return {
      status: 'connected',
      modelCount: catalog.models.length,
      models: catalog.models.map((model) => model.id),
      recommendedModel: catalog.recommendedModel,
    };
  }

  async refreshCatalog(): Promise<{ status: 'disconnected' | 'unchanged' | 'updated'; modelCount?: number }> {
    const apiKey = await this.credentials!.revealGatewayStoredApiKey('xopc-cloud');
    if (!apiKey) return { status: 'disconnected' };
    const previous = this.catalogStore.getSource('xopc-cloud');
    const catalog = await this.fetchCatalog(apiKey, previous?.etag);
    if (!catalog) {
      if (previous) this.catalogStore.saveSource('xopc-cloud', { ...previous, lastSuccessAt: this.now() });
      return { status: 'unchanged' };
    }
    await this.install(apiKey, catalog, false);
    return { status: 'updated', modelCount: catalog.models.length };
  }

  private getOrCreateDeviceId(): string {
    if (existsSync(this.deviceIdPath)) {
      try {
        const value = JSON.parse(readFileSync(this.deviceIdPath, 'utf8')) as { deviceId?: unknown };
        if (typeof value.deviceId === 'string' && value.deviceId.length >= 16) return value.deviceId;
      } catch {
        // Replace invalid local identity state.
      }
    }
    const deviceId = randomBytes(32).toString('base64url');
    writeTextAtomicSync(this.deviceIdPath, JSON.stringify({ deviceId }), { mode: 0o600 });
    return deviceId;
  }

  private async fetchCatalog(apiKey: string, etag?: string | null): Promise<CatalogResult | null> {
    const headers = new Headers({ authorization: `Bearer ${apiKey}` });
    if (etag) headers.set('if-none-match', etag);
    const response = await this.fetchImpl(`${this.routerUrl}/catalog`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 304) return null;
    const rawBody = await response.json().catch(() => null);
    if (!response.ok) {
      const body = rawBody && typeof rawBody === 'object' ? rawBody as Record<string, unknown> : null;
      const errorBody = body?.error && typeof body.error === 'object'
        ? body.error as Record<string, unknown>
        : null;
      const code = typeof errorBody?.code === 'string' ? errorBody.code : undefined;
      const authorizationFailed = response.status === 401 || response.status === 403;
      throw new XopcCloudHttpError(
        authorizationFailed
          ? 'XOPC Model Service authorization expired. Reconnect the service.'
          : 'Unable to load the XOPC model catalog',
        response.status,
        code,
      );
    }
    const catalog = parseJson<{ models?: unknown; recommendedModel?: unknown }>(
      rawBody,
      'XOPC model catalog returned an invalid response',
    );
    if (!Array.isArray(catalog.models)) throw new Error('Unable to load the XOPC model catalog');
    const models = catalog.models.flatMap((item): CatalogModel[] => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      if (typeof value.id !== 'string' || !value.id.trim() || value.id.includes('/')) return [];
      return [{
        id: value.id,
        name: typeof value.name === 'string' && value.name.trim() ? value.name : value.id,
        maxOutputTokens: typeof value.maxOutputTokens === 'number' && value.maxOutputTokens > 0
          ? value.maxOutputTokens
          : null,
      }];
    });
    if (models.length === 0) throw new Error('No XOPC models are currently available');
    return {
      models,
      recommendedModel: typeof catalog.recommendedModel === 'string' ? catalog.recommendedModel : null,
      etag: response.headers.get('etag'),
    };
  }

  private async install(apiKey: string, catalog: CatalogResult, saveCredential: boolean): Promise<void> {
    const previousKey = await this.credentials!.revealGatewayStoredApiKey('xopc-cloud');
    if (saveCredential) await this.credentials!.saveApiKey('xopc-cloud', apiKey, { envVar: null });
    try {
      this.catalogStore.replaceSourceModels('xopc-cloud', {
        providerId: 'xopc-cloud',
        baseUrl: this.routerUrl,
        api: 'openai-completions',
        etag: catalog.etag,
        recommendedModel: catalog.recommendedModel,
        lastSuccessAt: this.now(),
      }, catalog.models);
    } catch (err) {
      if (saveCredential) {
        if (previousKey) await this.credentials!.saveApiKey('xopc-cloud', previousKey, { envVar: null });
        else await this.credentials!.deleteProfile('xopc-cloud:default');
      }
      throw err;
    }
    this.refreshModels();
  }
}
