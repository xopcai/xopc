import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { containedPath } from './validation.js';
import { createPluginSourceFetch } from './source-http-fetch.js';
import type { AgentPluginStore, InstalledAgentPlugin } from './store.js';

const resourceVariant = z.strictObject({
  url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  maxBytes: z.number().int().positive().max(50 * 1024 * 1024).default(50 * 1024 * 1024),
  executable: z.boolean().default(false),
  platform: z.enum(['darwin', 'linux', 'win32']).optional(), arch: z.enum(['arm64', 'x64']).optional(),
});
const resourceId = z.string().min(1).max(64).regex(/^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/);
const resourcesSchema = z.array(z.union([
  resourceVariant.extend({ id: resourceId }).strict(),
  z.strictObject({ id: resourceId, variants: z.array(resourceVariant).min(1).max(6) }),
])).max(20);
export function pluginResources(plugin: Pick<InstalledAgentPlugin, 'manifest'>) {
  const extension = plugin.manifest.extensions?.['ai.xopc'] as { setup?: { version?: number; resources?: unknown } } | undefined;
  if (extension?.setup?.version !== undefined && extension.setup.version !== 1) throw new Error('Unsupported plugin setup protocol version');
  const ids = new Set<string>();
  return resourcesSchema.parse(extension?.setup?.resources ?? []).map(resource => {
    if (ids.has(resource.id)) throw new Error('Duplicate plugin resource');
    ids.add(resource.id);
    if (!('variants' in resource)) return resource;
    const matches = resource.variants.filter(value => (!value.platform || value.platform === process.platform) && (!value.arch || value.arch === process.arch));
    if (matches.length !== 1) throw new Error(`Expected one resource variant for this platform: ${resource.id}`);
    return { ...matches[0], id: resource.id };
  });
}
function verified(path: string, sha256: string, maxBytes: number): Buffer | undefined {
  if (!existsSync(path)) return;
  const stat = statSync(path); if (!stat.isFile() || stat.size > maxBytes) return;
  const data = readFileSync(path);
  return createHash('sha256').update(data).digest('hex') === sha256 ? data : undefined;
}
function atomicFile(path: string, data: Buffer, mode: number): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const pending = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(pending, data, { mode, flag: 'wx' }); renameSync(pending, path); }
  finally { rmSync(pending, { force: true }); }
}
/** Download pinned files; execute them only later through an explicitly reviewed MCP process. */
export async function preparePluginResources(store: AgentPluginStore, plugin: InstalledAgentPlugin, signal: AbortSignal): Promise<void> {
  const dataRoot = store.dataDir(plugin.id), cacheRoot = join(store.stateDir, 'plugin-resource-cache');
  for (const resource of pluginResources(plugin)) {
    signal.throwIfAborted();
    if (resource.platform && resource.platform !== process.platform || resource.arch && resource.arch !== process.arch) throw new Error(`Resource is unavailable for this platform: ${resource.id}`);
    const target = containedPath(dataRoot, join(dataRoot, 'resources', plugin.receipt.revision, resource.id));
    if (verified(target, resource.sha256, resource.maxBytes) && (!resource.executable || (statSync(target).mode & 0o111) !== 0)) continue;
    const cached = containedPath(cacheRoot, join(cacheRoot, resource.sha256));
    let data = verified(cached, resource.sha256, resource.maxBytes);
    if (!data) {
      const url = new URL(resource.url);
      const response = await createPluginSourceFetch(url, {})(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
      if (!response.ok || !response.body) throw new Error(`Resource download failed: ${resource.id}`);
      const chunks: Uint8Array[] = []; let bytes = 0;
      const reader = response.body.getReader();
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > resource.maxBytes) throw new Error('Resource exceeds size limit'); chunks.push(part.value); }
      } finally { await reader.cancel(); }
      data = Buffer.concat(chunks);
      if (createHash('sha256').update(data).digest('hex') !== resource.sha256) throw new Error(`Resource integrity failed: ${resource.id}`);
    }
    signal.throwIfAborted();
    const content = data;
    store.withRevision(plugin.id, plugin.receipt.revision, () => {
      atomicFile(cached, content, 0o600);
      // Independent copies prevent a plugin from changing another plugin's cached bytes.
      atomicFile(containedPath(dataRoot, target), content, resource.executable ? 0o700 : 0o600);
    });
  }
}

/** Derive ownership from retained revisions, including rollback and staged packages. */
export function prunePluginResourceCache(store: AgentPluginStore): void {
  const cacheRoot = join(store.stateDir, 'plugin-resource-cache');
  if (!existsSync(cacheRoot)) return;
  const referenced = new Set<string>();
  for (const plugin of store.list()) for (const revision of store.history(plugin.id)) {
    if (existsSync(revision.rootDir)) for (const hash of revision.receipt.resourceHashes ?? []) referenced.add(hash);
  }
  for (const name of readdirSync(cacheRoot)) if (/^[a-f0-9]{64}$/.test(name) && !referenced.has(name)) rmSync(join(cacheRoot, name), { force: true });
}
