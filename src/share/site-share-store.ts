import { randomBytes, randomUUID } from 'node:crypto';
import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { stat, readdir, lstat, realpath } from 'node:fs/promises';
import { relative as relPathPosix, resolve as resolvePath } from 'node:path';

import { isPathUnderWorkspace } from '../gateway/workspace-editor-path.js';
import { createLogger } from '../utils/logger.js';
import {
  SITE_SHARE_CONFIG_DEFAULTS,
  type CreateSiteShareParams,
  type SiteShareConfig,
  type SiteShareRecord,
  type SiteSource,
} from './site-share-types.js';

const log = createLogger('SiteShareStore');

const CLEANUP_INTERVAL_MS = 10 * 60_000;
const EXPIRED_RETENTION_MS = 24 * 60 * 60_000;
const SUBDOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;


export class SiteShareStore {
  private shares = new DurableState<SiteShareRecord>('site-shares');
  private config: SiteShareConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** Optional cleanup hook invoked when a record is dropped (e.g. delete staging dir). */
  private onCleanup: ((record: SiteShareRecord) => void) | null = null;

  constructor(config?: Partial<SiteShareConfig>) {
    this.config = { ...SITE_SHARE_CONFIG_DEFAULTS, ...config };
    this.startCleanupTimer();
  }

  private saveNew(record: SiteShareRecord): void {
    requireXopcDatabase();
    runSqliteWriteTransaction(() => {
      if (this.getActiveShares().length >= this.config.maxActiveSites) throw new Error('Maximum active shares reached');
      this.shares.set(record.id, record);
    });
  }

  updateConfig(config: Partial<SiteShareConfig>): void {
    this.config = { ...this.config, ...config };
  }

  setCleanupHook(hook: (record: SiteShareRecord) => void): void {
    this.onCleanup = hook;
  }

  getConfig(): SiteShareConfig {
    return JSON.parse(JSON.stringify(this.config)) as SiteShareConfig;
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async create(
    params: CreateSiteShareParams & {
      workspaceRoot: string | null;
      gatewayTokenHash: string;
    },
  ): Promise<SiteShareRecord> {
    if (!this.config.enabled) throw new Error('Site sharing is disabled');

    const active = this.getActiveShares();
    if (active.length >= this.config.maxActiveSites) {
      throw new Error(`Maximum active site shares reached (${this.config.maxActiveSites})`);
    }

    const ttlMs = params.ttlMs ?? this.config.defaultTtlMs;
    if (ttlMs < 60_000 || ttlMs > this.config.maxTtlMs) {
      throw new Error(`TTL must be between 60s and ${this.config.maxTtlMs / 1000}s`);
    }

    const source = await this.buildSource(params);

    const subdomain = this.resolveSubdomain(params.subdomain);
    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    const now = new Date();
    const record: SiteShareRecord = {
      id,
      token,
      subdomain,
      source,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      revoked: false,
      description: params.description,
      createdByTokenHash: params.gatewayTokenHash,
      requestCount: 0,
      uniqueClientCount: 0,
      maxRequests: params.maxRequests ?? null,
    };

    this.saveNew(record);

    log.info(
      { id, tokenPrefix: token.slice(0, 8), subdomain, kind: source.kind },
      `Site share created (${source.kind})`,
    );

    return record;
  }

  private async buildSource(params: CreateSiteShareParams & { workspaceRoot: string | null }): Promise<SiteSource> {
    if (params.kind === 'static') {
      if (!this.config.static.enabled) throw new Error('Static site sharing is disabled');
      if (!params.workspaceRoot) throw new Error('workspaceRoot required for static site shares');
      if (!params.path) throw new Error('path required for static site shares');
      const relPath = params.path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (!relPath) throw new Error('Empty path');
      if (relPath.includes('..') || relPath.includes('\0')) throw new Error('Invalid path');
      const absRoot = resolvePath(params.workspaceRoot, relPath);
      const relToRoot = relPathPosix(resolvePath(params.workspaceRoot), absRoot);
      if (relToRoot.startsWith('..') || relToRoot.split(/[/\\]/).includes('..')) {
        throw new Error('Path is outside workspace');
      }
      const real = await realpath(absRoot);
      if (!isPathUnderWorkspace(params.workspaceRoot, real)) {
        throw new Error('Path target is outside workspace');
      }
      const stats = await stat(absRoot);
      if (!stats.isDirectory()) throw new Error('Static source must be a directory');
      const summary = await scanStatic(absRoot, this.config.static.maxFileCount, this.config.static.maxRootDirSize);
      log.debug({ ...summary, rootDir: absRoot }, 'Static site scanned');
      return {
        kind: 'static',
        rootDir: absRoot,
        workspaceRoot: params.workspaceRoot,
        workspaceRelativePath: relPath,
        spaFallback: params.spaFallback ?? true,
        rewriteMode: params.rewriteMode ?? (this.config.static.rewriteEnabledByDefault ? 'html-css' : 'none'),
      };
    }

    if (params.kind === 'proxy') {
      if (!this.config.proxy.enabled) throw new Error('Proxy site sharing is disabled');
      if (!params.upstreamUrl) throw new Error('upstreamUrl required for proxy shares');
      const validated = validateUpstreamUrl(params.upstreamUrl, this.config.proxy);
      return {
        kind: 'proxy',
        upstreamUrl: validated,
        rewriteSetCookiePath: this.config.proxy.rewriteSetCookiePath,
        forwardWebSocket: params.forwardWebSocket ?? this.config.proxy.forwardWebSocket,
        forwardedHeaders: 'minimal',
      };
    }

    throw new Error(`Unsupported site share kind: ${params.kind}`);
  }

  private resolveSubdomain(preferred?: string): string | null {
    if (!preferred) return null;
    const lower = preferred.trim().toLowerCase();
    if (!SUBDOMAIN_PATTERN.test(lower)) {
      throw new Error('Subdomain must match /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/');
    }
    if (this.hasSubdomain(lower)) {
      throw new Error(`Subdomain '${lower}' already in use`);
    }
    return lower;
  }

  getById(id: string): SiteShareRecord | null {
    return this.shares.get(id) ?? null;
  }

  getByToken(token: string): SiteShareRecord | null {
    return this.shares.values().find(record => record.token === token) ?? null;
  }

  getBySubdomain(subdomain: string): SiteShareRecord | null {
    return this.shares.values().find(record => record.subdomain === subdomain.toLowerCase()) ?? null;
  }

  /**
   * Look up a record by token first, then by subdomain. Subdomain label may
   * itself be the share token (when user didn't pick a custom subdomain).
   */
  resolveByHostLabel(label: string): SiteShareRecord | null {
    return this.getByToken(label) ?? this.getBySubdomain(label);
  }

  getActiveShares(): SiteShareRecord[] {
    const now = Date.now();
    return [...this.shares.values()].filter(
      (r) => !r.revoked && now < new Date(r.expiresAt).getTime(),
    );
  }

  getAllShares(): SiteShareRecord[] {
    return [...this.shares.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  validateAccess(record: SiteShareRecord): { valid: boolean; reason?: string } {
    if (record.revoked) return { valid: false, reason: 'revoked' };
    if (Date.now() >= new Date(record.expiresAt).getTime()) return { valid: false, reason: 'expired' };
    if (record.maxRequests !== null && record.requestCount >= record.maxRequests) {
      return { valid: false, reason: 'max_requests' };
    }
    return { valid: true };
  }

  /** Increment counters when a request lands. Persisted before returning. */
  recordRequest(id: string, clientIp: string): void {
    this.shares.update(id, record => {
      if (record) {
        record.requestCount++;
        const recent = (record.recentClientIps ??= []);
        if (!recent.includes(clientIp)) {
          recent.unshift(clientIp);
          if (recent.length > 200) recent.length = 200;
          record.uniqueClientCount = recent.length;
        }
      }
      return { value: record, result: undefined };
    });
  }

  setThumbnailStatus(id: string, status: 'pending' | 'ready' | 'failed'): void {
    requireXopcDatabase();
    return runSqliteWriteTransaction(() => {
      const record = this.shares.get(id);
      if (!record) return;
      record.thumbnailStatus = status;
      if (status === 'ready') record.thumbnailGeneratedAt = new Date().toISOString();
      if (status === 'failed') record.thumbnailFailedAt = new Date().toISOString();
      this.shares.set(record.id, record);
    });
  }

  revoke(id: string): boolean {
    requireXopcDatabase();
    return runSqliteWriteTransaction(() => {
      const record = this.shares.get(id);
      if (!record) return false;
      record.revoked = true;
      this.shares.set(record.id, record);
      if (this.onCleanup) {
        try {
          this.onCleanup(record);
        } catch (err) {
          log.warn({ err, id }, 'Site share cleanup hook threw on revoke');
        }
      }
      log.info({ id, tokenPrefix: record.token.slice(0, 8) }, 'Site share revoked');
      return true;
    });
  }

  revokeMany(ids: string[]): number {
    requireXopcDatabase();
    return runSqliteWriteTransaction(() => {
      let count = 0;
      for (const id of ids) {
        const record = this.shares.get(id);
        if (record && !record.revoked) {
          record.revoked = true;
          this.shares.set(record.id, record);
          count++;
        }
      }

      return count;
    });
  }

  revokeExpired(): number {
    requireXopcDatabase();
    return runSqliteWriteTransaction(() => {
      const now = Date.now();
      let count = 0;
      for (const record of this.shares.values()) {
        if (!record.revoked && now >= new Date(record.expiresAt).getTime()) {
          record.revoked = true;
          this.shares.set(record.id, record);
          count++;
        }
      }

      return count;
    });
  }

  update(id: string, patch: { extendTtlMs?: number; maxRequests?: number | null }): SiteShareRecord | null {
    requireXopcDatabase();
    return runSqliteWriteTransaction(() => {
      const record = this.shares.get(id);
      if (!record) return null;
      if (patch.extendTtlMs !== undefined) {
        record.expiresAt = new Date(Date.now() + patch.extendTtlMs).toISOString();
      }
      if (patch.maxRequests !== undefined) {
        record.maxRequests = patch.maxRequests;
      }
      this.shares.set(record.id, record);
      return record;
    });
  }

  private hasSubdomain(subdomain: string): boolean { return this.getBySubdomain(subdomain) !== null; }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      let removed = 0;
      for (const [id, record] of this.shares) {
        const expiredMs = now - new Date(record.expiresAt).getTime();
        if (expiredMs > EXPIRED_RETENTION_MS) {
          this.shares.delete(id);
          if (this.onCleanup) {
            try {
              this.onCleanup(record);
            } catch (err) {
              log.warn({ err, id }, 'Site share cleanup hook threw');
            }
          }
          removed++;
        }
      }
      if (removed > 0) {
        log.debug({ removed }, `Cleaned ${removed} expired site shares`);
      }
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function scanStatic(
  root: string,
  maxFileCount: number,
  maxRootDirSize: number,
): Promise<{ fileCount: number; totalSize: number }> {
  let fileCount = 0;
  let totalSize = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 16) return;
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (fileCount >= maxFileCount) throw new Error(`Static site exceeds maxFileCount (${maxFileCount})`);
      const abs = resolvePath(dir, dirent.name);
      const lst = await lstat(abs);
      if (lst.isSymbolicLink()) continue; // never follow symlinks in a public static root
      if (lst.isFile()) {
        fileCount++;
        totalSize += lst.size;
        if (totalSize > maxRootDirSize) {
          const mb = (maxRootDirSize / 1_048_576).toFixed(0);
          throw new Error(`Static site exceeds maxRootDirSize (${mb} MB)`);
        }
      } else if (lst.isDirectory()) {
        await walk(abs, depth + 1);
      }
    }
  }

  await walk(root, 0);
  return { fileCount, totalSize };
}

function validateUpstreamUrl(raw: string, cfg: SiteShareConfig['proxy']): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('upstreamUrl must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('upstreamUrl must use http or https');
  }
  const host = parsed.hostname.toLowerCase();
  if (!cfg.allowedUpstreamHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new Error(`upstream host '${host}' is not in allowedUpstreamHosts`);
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (!cfg.allowedUpstreamPorts.includes(port)) {
    throw new Error(`upstream port ${port} is not in allowedUpstreamPorts`);
  }
  // Strip path / search / hash — proxy uses base only
  return `${parsed.protocol}//${parsed.host}`;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let singleton: SiteShareStore | null = null;

export function getSiteShareStore(config?: Partial<SiteShareConfig>): SiteShareStore {
  if (!singleton) singleton = new SiteShareStore(config);
  return singleton;
}

export function resetSiteShareStoreForTests(): void {
  singleton?.shutdown();
  singleton = null;
}
