import type { RuntimeToolsConfig } from '../config/schema.js';
import type { RuntimeAsset, RuntimePlatform } from './catalog.js';
import { resolveExpectedChecksum } from './downloader.js';
import { RuntimeError } from './errors.js';
import { fetchRuntimeResource, readRuntimeResponseText } from './network.js';

type DownloadConfig = RuntimeToolsConfig['download'];
const MAX_GATEWAY_RESPONSE_BYTES = 64 * 1024;

export interface ResolvedRuntimeDownload {
  url: string;
  sha256: string;
  source: 'website' | 'direct';
}

export function runtimeGatewayPythonMirror(gatewayBaseUrl: string): string {
  return `${gatewayBaseUrl.replace(/\/+$/, '')}/python-build-standalone`;
}

export function canFallbackPythonInstall(output: string, timedOut: boolean): boolean {
  if (/checksum|digest|hash mismatch|integrity|verification failed|invalid archive/i.test(output)) return false;
  return timedOut || /failed to download|request failed|error sending request|timed? out|connection|dns|429|50[234]/i.test(output);
}

class GatewayResolveError extends Error {
  constructor(
    message: string,
    readonly allowsDirectFallback: boolean,
    readonly retrySameSource = allowsDirectFallback,
  ) {
    super(message);
  }
}

function descriptorUrl(baseUrl: string, asset: RuntimeAsset, platform: RuntimePlatform): URL {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/resolve`);
  url.searchParams.set('runtime', asset.runtime);
  url.searchParams.set('version', asset.version);
  url.searchParams.set('platform', platform);
  return url;
}

export function validateGatewayDescriptor(params: {
  value: unknown;
  gatewayBaseUrl: string;
  asset: RuntimeAsset;
  platform: RuntimePlatform;
}): ResolvedRuntimeDownload {
  const value = params.value as Record<string, unknown> | null;
  const archive = value?.archive as Record<string, unknown> | null;
  if (
    value?.schemaVersion !== 1
    || value.runtime !== params.asset.runtime
    || value.version !== params.asset.version
    || value.platform !== params.platform
    || archive?.name !== params.asset.archiveFile
    || archive.archiveType !== params.asset.archiveType
    || typeof archive.url !== 'string'
    || typeof archive.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(archive.sha256)
  ) {
    throw new GatewayResolveError('Runtime gateway returned an invalid descriptor', false);
  }

  const base = new URL(`${params.gatewayBaseUrl.replace(/\/+$/, '')}/`);
  const artifact = new URL(archive.url);
  const expectedPath = `${base.pathname}artifacts/${params.asset.runtime}/${params.asset.version}/${params.platform}/${params.asset.archiveFile}`;
  if (
    artifact.origin !== base.origin
    || artifact.username
    || artifact.password
    || artifact.pathname !== expectedPath
    || artifact.search
    || artifact.hash
  ) {
    throw new GatewayResolveError('Runtime gateway returned an untrusted artifact URL', false);
  }
  return { url: artifact.href, sha256: archive.sha256, source: 'website' };
}

async function resolveFromGateway(params: {
  asset: RuntimeAsset;
  platform: RuntimePlatform;
  config: DownloadConfig;
  signal?: AbortSignal;
}): Promise<ResolvedRuntimeDownload> {
  let lastError: GatewayResolveError | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (params.signal?.aborted) throw params.signal.reason;
    try {
      const response = await fetchRuntimeResource({
        url: descriptorUrl(params.config.gatewayBaseUrl, params.asset, params.platform).href,
        timeoutMs: params.config.timeoutMs,
        proxy: params.config.proxy,
        signal: params.signal,
        init: {
          headers: { 'User-Agent': 'xopc-runtime-manager/1' },
          redirect: 'error',
        },
      });
      const declaredSize = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_GATEWAY_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw new GatewayResolveError('Runtime gateway response exceeds the size limit', false);
      }
      let responseText: string;
      try {
        responseText = await readRuntimeResponseText(response, MAX_GATEWAY_RESPONSE_BYTES);
      } catch {
        throw new GatewayResolveError('Runtime gateway response exceeds the size limit', false);
      }
      if (!response.ok) {
        let body: { error?: unknown } | null = null;
        try {
          body = JSON.parse(responseText) as { error?: unknown };
        } catch {
          // The HTTP status still determines whether a gateway failure is retryable.
        }
        const unsupported = response.status === 404 && body?.error === 'unsupported_catalog_entry';
        const retryable = unsupported || response.status === 429 || response.status >= 500;
        throw new GatewayResolveError(
          `Runtime gateway returned HTTP ${response.status}`,
          retryable,
          !unsupported && retryable,
        );
      }
      let descriptor: unknown;
      try {
        descriptor = JSON.parse(responseText);
      } catch {
        throw new GatewayResolveError('Runtime gateway returned invalid JSON', false);
      }
      return validateGatewayDescriptor({
        value: descriptor,
        gatewayBaseUrl: params.config.gatewayBaseUrl,
        asset: params.asset,
        platform: params.platform,
      });
    } catch (error) {
      if (params.signal?.aborted) throw error;
      const normalized = error instanceof GatewayResolveError
        ? error
        : new GatewayResolveError(
            error instanceof Error ? error.message : String(error),
            true,
          );
      if (!normalized.allowsDirectFallback) throw normalized;
      lastError = normalized;
      if (!normalized.retrySameSource) break;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError ?? new GatewayResolveError('Runtime gateway is unavailable', true);
}

async function resolveDirect(
  asset: RuntimeAsset,
  config: DownloadConfig,
  signal?: AbortSignal,
): Promise<ResolvedRuntimeDownload> {
  const sha256 = await resolveExpectedChecksum({
    runtime: asset.runtime,
    checksumUrl: asset.checksumUrl,
    archiveFile: asset.archiveFile,
    timeoutMs: config.timeoutMs,
    proxy: config.proxy,
    signal,
  });
  return { url: asset.url, sha256, source: 'direct' };
}

export async function resolveRuntimeDownloadSource(params: {
  asset: RuntimeAsset;
  platform: RuntimePlatform;
  config: DownloadConfig;
  signal?: AbortSignal;
  onFallback?: (message: string) => void;
}): Promise<ResolvedRuntimeDownload> {
  if (params.config.source === 'direct-only') {
    return await resolveDirect(params.asset, params.config, params.signal);
  }
  try {
    return await resolveFromGateway(params);
  } catch (error) {
    if (
      params.config.source === 'website-only'
      || !(error instanceof GatewayResolveError)
      || !error.allowsDirectFallback
    ) {
      throw new RuntimeError(
        `Failed to resolve ${params.asset.runtime} from the runtime gateway: ${error instanceof Error ? error.message : String(error)}`,
        'RUNTIME_DOWNLOAD_FAILED',
        params.asset.runtime,
        'resolve_gateway',
        true,
        [],
        { cause: error },
      );
    }
    params.onFallback?.(`Runtime gateway unavailable; downloading ${params.asset.runtime} directly`);
    return await resolveDirect(params.asset, params.config, params.signal);
  }
}
