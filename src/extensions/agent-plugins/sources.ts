import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../config/schema.js';
import { createPluginSourceFetch } from './source-http-fetch.js';
import AdmZip from 'adm-zip';

export interface AgentPluginSourceProvenance {
  kind: 'store';
  packageName: string;
  packageType: 'plugin' | 'extension';
  version: string;
  sha256: string;
  publisherVerification?: 'community' | 'verified';
  sourceRepository?: string;
  sourceCommit?: string;
  artifactFormat?: string;
  riskTier?: 'content' | 'network' | 'local-exec';
}

export function isAgentPluginArchive(buffer: Buffer): boolean {
  const entries = new AdmZip(buffer).getEntries();
  const paths = entries.map(entry => entry.entryName.replace(/\/$/, ''));
  const nativeMetadata = (path: string) => {
    const entry = entries.find(item => item.entryName === path);
    if (!entry) return false;
    if (entry.header.size > 1024 * 1024) throw new Error('Package metadata exceeds 1 MiB');
    return Boolean(JSON.parse(entry.getData().toString('utf8'))?.xopc?.extension);
  };
  if (paths.includes('xopc.extension.json')) return false;
  if (paths.includes('plugin.json')) return !nativeMetadata('package.json');
  const first = new Set(paths.map(path => path.split('/')[0]));
  if (first.size !== 1) return false;
  const root = [...first][0];
  return paths.includes(`${root}/plugin.json`) && !paths.includes(`${root}/xopc.extension.json`) && !nativeMetadata(`${root}/package.json`);
}
export function withAgentPluginArchive<T>(buffer: Buffer, fn: (local: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-plugin-download-'));
  try { const file = join(dir, 'plugin.zip'); writeFileSync(file, buffer); return fn(file); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Resolve remote artifacts only for explicit inspect/install requests, never during discovery. */
export async function withAgentPluginSource<T>(source: string, config: Config | undefined, fn: (local: string, provenance?: AgentPluginSourceProvenance) => T): Promise<T> {
  if (!source.startsWith('https://') && !source.startsWith('store:')) return fn(source);
  let buffer: Buffer;
  let provenance: AgentPluginSourceProvenance | undefined;
  if (source.startsWith('store:')) {
    const { fetchMarketplacePackageDetail, resolveExtensionZipDownloadUrl, resolveExtensionsStoreBaseUrl, downloadExtensionStoreZipBuffer, verifyStoreArtifactSha256 } = await import('../../agent/skills/marketplace/adapters/store/store-api-client.js');
    const spec = source.slice(6);
    const match = /^([a-z0-9.-]+)(?:@([^/]+))?$/.exec(spec);
    if (!match) throw new Error('Expected store:<package>[@version]');
    const base = resolveExtensionsStoreBaseUrl(config);
    const detail = await fetchMarketplacePackageDetail(base, match[1]);
    if (detail.type !== 'plugin' && detail.type !== 'extension') throw new Error(`Store package has unsupported type: ${detail.type}`);
    const artifact = await resolveExtensionZipDownloadUrl(base, match[1], match[2]);
    buffer = await downloadExtensionStoreZipBuffer(base, artifact.downloadUrl);
    verifyStoreArtifactSha256(buffer, artifact.sha256);
    provenance = {
      kind: 'store', packageName: match[1], packageType: detail.type, version: artifact.version,
      sha256: artifact.sha256!,
      ...(detail.publisher?.verification ? { publisherVerification: detail.publisher.verification } : {}),
      ...(detail.publisher?.sourceRepository ? { sourceRepository: detail.publisher.sourceRepository } : {}),
      ...(artifact.sourceCommit ? { sourceCommit: artifact.sourceCommit } : {}),
      ...(artifact.artifactFormat ? { artifactFormat: artifact.artifactFormat } : {}),
      ...(artifact.riskTier ? { riskTier: artifact.riskTier } : {}),
    };
  } else {
    const url = new URL(source);
    const response = await createPluginSourceFetch(url, {})(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok || !response.body) throw new Error(`Plugin download failed (${response.status})`);
    const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 50 * 1024 * 1024) throw new Error('Plugin download exceeds 50 MiB');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    buffer = Buffer.concat(chunks);
  }
  return withAgentPluginArchive(buffer, local => fn(local, provenance));
}
