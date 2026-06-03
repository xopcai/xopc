import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative as relPathPosix, resolve as resolvePath } from 'node:path';
import { stat, lstat, realpath, readdir } from 'node:fs/promises';

import { resolveStateDir } from '../config/paths.js';
import { isPathUnderWorkspace } from '../gateway/workspace-editor-path.js';
import { createLogger } from '../utils/logger.js';
import { logShareAudit } from './share-audit.js';
import type {
  ShareRecord,
  ShareStoreData,
  ShareConfig,
  CreateShareParams,
  ShareKind,
} from './share-types.js';
import { SHARE_CONFIG_DEFAULTS } from './share-types.js';

const log = createLogger('ShareStore');

const SHARES_FILE = 'shares.json';
const CLEANUP_INTERVAL_MS = 10 * 60_000;
const EXPIRED_RETENTION_MS = 24 * 60 * 60_000;
const MAX_STORED_RECORDS = 500;
const TRUNCATE_TO = 200;
const COUNTER_DEBOUNCE_MS = 2_000;

function resolveSharesPath(): string {
  return join(resolveStateDir(), SHARES_FILE);
}

export interface DirectoryListingEntry {
  name: string;
  /** Workspace/share-relative POSIX path. */
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
  mimeType: string;
}

export interface DirectoryListing {
  /** Share-relative path of the listed dir ('' for root). */
  path: string;
  entries: DirectoryListingEntry[];
  truncated: boolean;
}

interface DirectoryScanSummary {
  entryCount: number;
  totalSize: number;
}

export class ShareStore {
  private shares = new Map<string, ShareRecord>();
  private tokenIndex = new Map<string, string>();
  private dirty = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private config: ShareConfig;
  private listingCache = new Map<string, { listing: DirectoryListing; expiresAt: number }>();

  constructor(config?: Partial<ShareConfig>) {
    this.config = { ...SHARE_CONFIG_DEFAULTS, ...config };
    this.load();
    this.startCleanupTimer();
  }

  updateConfig(config: Partial<ShareConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ShareConfig {
    return { ...this.config };
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async create(
    params: CreateShareParams & {
      workspaceRoot: string;
      gatewayTokenHash: string;
    },
  ): Promise<ShareRecord> {
    if (!this.config.enabled) {
      throw new Error('File sharing is disabled');
    }

    const activeCount = this.getActiveShares().length;
    if (activeCount >= this.config.maxActiveShares) {
      throw new Error(`Maximum active shares reached (${this.config.maxActiveShares})`);
    }

    const { path: relPath, workspaceRoot, gatewayTokenHash } = params;
    const ttlMs = params.ttlMs ?? this.config.defaultTtlMs;

    if (ttlMs < 60_000 || ttlMs > this.config.maxTtlMs) {
      throw new Error(`TTL must be between 60s and ${this.config.maxTtlMs / 1000}s`);
    }
    if (params.maxViews !== undefined && params.maxViews !== null) {
      if (params.maxViews < 1 || params.maxViews > 1000) {
        throw new Error('maxViews must be between 1 and 1000');
      }
    }

    const absolutePath = await this.resolveAndValidatePath(relPath, workspaceRoot);
    const fileStat = await stat(absolutePath);

    const detectedKind: ShareKind = fileStat.isDirectory() ? 'directory' : 'file';
    const requestedKind = params.kind ?? detectedKind;
    if (requestedKind !== detectedKind) {
      throw new Error(
        `Requested share kind '${requestedKind}' does not match filesystem (got '${detectedKind}')`,
      );
    }

    if (requestedKind === 'file') {
      return this.createFileShare({
        params,
        absolutePath,
        fileStat,
        relPath,
        workspaceRoot,
        ttlMs,
        gatewayTokenHash,
      });
    }

    return this.createDirectoryShare({
      params,
      absolutePath,
      fileStat,
      relPath,
      workspaceRoot,
      ttlMs,
      gatewayTokenHash,
    });
  }

  private async createFileShare(args: {
    params: CreateShareParams;
    absolutePath: string;
    fileStat: import('node:fs').Stats;
    relPath: string;
    workspaceRoot: string;
    ttlMs: number;
    gatewayTokenHash: string;
  }): Promise<ShareRecord> {
    const { params, absolutePath, fileStat, relPath, workspaceRoot, ttlMs, gatewayTokenHash } = args;

    if (!fileStat.isFile()) {
      throw new Error('Path is not a regular file');
    }
    if (fileStat.size > this.config.maxFileSize) {
      const maxMb = (this.config.maxFileSize / 1_048_576).toFixed(0);
      throw new Error(`File size exceeds maximum (${maxMb} MB)`);
    }

    const linkStat = await lstat(absolutePath);
    if (linkStat.isSymbolicLink()) {
      const real = await realpath(absolutePath);
      if (!isPathUnderWorkspace(workspaceRoot, real)) {
        throw new Error('Symlink target is outside workspace');
      }
    }

    const fileName = relPath.split('/').pop() || relPath;
    const mimeType = resolveMimeType(fileName);
    const record = this.buildRecord({
      kind: 'file',
      absolutePath,
      workspaceRoot,
      workspaceRelativePath: relPath,
      inode: fileStat.ino,
      fileName,
      fileSize: fileStat.size,
      mimeType,
      ttlMs,
      maxViews: params.maxViews,
      description: params.description,
      gatewayTokenHash,
    });

    this.persistAndAudit(record, 'share.create', `Share created: ${record.fileName}`, {
      fileName: record.fileName,
      fileSize: record.fileSize,
      ttlMs,
    });

    return record;
  }

  private async createDirectoryShare(args: {
    params: CreateShareParams;
    absolutePath: string;
    fileStat: import('node:fs').Stats;
    relPath: string;
    workspaceRoot: string;
    ttlMs: number;
    gatewayTokenHash: string;
  }): Promise<ShareRecord> {
    const { params, absolutePath, fileStat, relPath, workspaceRoot, ttlMs, gatewayTokenHash } = args;
    const dirCfg = this.config.directory;
    if (!dirCfg.enabled) {
      throw new Error('Directory sharing is disabled');
    }

    const followSymlinks = params.followSymlinks ?? false;
    const maxDepth = params.maxDepth ?? dirCfg.maxDepth;
    const maxFileCount = Math.min(params.maxFileCount ?? dirCfg.maxFileCount, dirCfg.maxFileCount);
    const maxFolderSize = Math.min(
      params.maxFolderSize ?? dirCfg.maxFolderSize,
      dirCfg.maxFolderSize,
    );

    const summary = await scanDirectory(absolutePath, {
      workspaceRoot,
      followSymlinks,
      maxDepth,
      maxFileCount,
      maxFolderSize,
    });

    const fileName = relPath.split('/').pop() || relPath || 'shared';
    const record = this.buildRecord({
      kind: 'directory',
      absolutePath,
      workspaceRoot,
      workspaceRelativePath: relPath,
      inode: fileStat.ino,
      fileName,
      fileSize: summary.totalSize,
      mimeType: 'application/x-directory',
      ttlMs,
      maxViews: params.maxViews,
      description: params.description,
      gatewayTokenHash,
      directory: {
        mode: params.directoryMode ?? 'browse',
        entryCount: summary.entryCount,
        followSymlinks,
        maxDepth,
      },
    });

    this.persistAndAudit(record, 'share.create', `Folder share created: ${record.fileName}`, {
      fileName: record.fileName,
      entryCount: summary.entryCount,
      totalSize: summary.totalSize,
      ttlMs,
      mode: record.directory?.mode,
    });

    return record;
  }

  private buildRecord(input: {
    kind: ShareKind;
    absolutePath: string;
    workspaceRoot: string;
    workspaceRelativePath: string;
    inode: number;
    fileName: string;
    fileSize: number;
    mimeType: string;
    ttlMs: number;
    maxViews?: number | null;
    description?: string;
    gatewayTokenHash: string;
    directory?: ShareRecord['directory'];
  }): ShareRecord {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const record: ShareRecord = {
      id,
      token,
      absolutePath: input.absolutePath,
      workspaceRelativePath: input.workspaceRelativePath,
      workspaceRoot: input.workspaceRoot,
      inode: input.inode,
      kind: input.kind,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
      maxViews: input.maxViews ?? null,
      downloadCount: 0,
      revoked: false,
      createdByTokenHash: input.gatewayTokenHash,
      description: input.description,
      directory: input.directory,
    };

    this.shares.set(id, record);
    this.tokenIndex.set(token, id);
    return record;
  }

  private persistAndAudit(
    record: ShareRecord,
    event: Parameters<typeof logShareAudit>[0],
    message: string,
    extra: Record<string, unknown>,
  ): void {
    this.persistSync();
    logShareAudit(event, { shareId: record.id, tokenPrefix: record.token.slice(0, 8), ...extra }, message);
  }

  getById(id: string): ShareRecord | null {
    return this.shares.get(id) ?? null;
  }

  getByToken(token: string): ShareRecord | null {
    const id = this.tokenIndex.get(token);
    if (!id) return null;
    return this.shares.get(id) ?? null;
  }

  /** Validate a share is still accessible for download. Returns null reason if valid. */
  validateAccess(record: ShareRecord): { valid: boolean; reason?: string } {
    if (record.revoked) return { valid: false, reason: 'revoked' };
    if (Date.now() >= new Date(record.expiresAt).getTime()) return { valid: false, reason: 'expired' };
    if (record.maxViews !== null && record.downloadCount >= record.maxViews) {
      return { valid: false, reason: 'max_views' };
    }
    return { valid: true };
  }

  /** Increment download counter (used by directory & file downloads). Debounced persist. */
  incrementDownloadCount(id: string): void {
    const record = this.shares.get(id);
    if (!record) return;
    record.downloadCount++;
    this.scheduleDebouncedPersist();
  }

  /** Check if the file still exists and inode matches. */
  async validateFileIntegrity(record: ShareRecord): Promise<{ valid: boolean; reason?: string }> {
    try {
      const realPath = await realpath(record.absolutePath);
      if (!isPathUnderWorkspace(record.workspaceRoot, realPath)) {
        return { valid: false, reason: 'file_deleted' };
      }
      const fileStat = await stat(record.absolutePath);
      if (fileStat.ino !== record.inode) {
        logShareAudit(
          'share.path_changed',
          {
            shareId: record.id,
            tokenPrefix: record.token.slice(0, 8),
            oldInode: record.inode,
            newInode: fileStat.ino,
          },
          `Share path replaced (inode changed): ${record.fileName}`,
        );
        return { valid: false, reason: 'file_deleted' };
      }
      return { valid: true };
    } catch {
      return { valid: false, reason: 'file_deleted' };
    }
  }

  /**
   * Resolve a child path inside a directory share. Returns the absolute path
   * if it stays within both the share root and the workspace.
   */
  async resolveDirectoryChild(
    record: ShareRecord,
    relativePath: string,
  ): Promise<{ ok: true; absolutePath: string } | { ok: false; reason: string }> {
    if (record.kind !== 'directory') {
      return { ok: false, reason: 'not_directory' };
    }
    const trimmed = (relativePath ?? '').replace(/^\/+/, '').replace(/\\/g, '/');
    if (trimmed.includes('..') || trimmed.includes('\0')) {
      return { ok: false, reason: 'path_traversal' };
    }
    const abs = resolvePath(record.absolutePath, trimmed);
    const relToShare = relPathPosix(record.absolutePath, abs);
    if (relToShare.startsWith('..') || relToShare.split(/[/\\]/).includes('..')) {
      return { ok: false, reason: 'path_outside_share' };
    }
    try {
      const real = await realpath(abs);
      if (!isPathUnderWorkspace(record.workspaceRoot, real)) {
        return { ok: false, reason: 'path_outside_workspace' };
      }
      const relToShareReal = relPathPosix(record.absolutePath, real);
      if (relToShareReal.startsWith('..') || relToShareReal.split(/[/\\]/).includes('..')) {
        return { ok: false, reason: 'path_outside_share' };
      }
      return { ok: true, absolutePath: real };
    } catch {
      return { ok: false, reason: 'not_found' };
    }
  }

  /** List a single directory level (cached, share-root-relative). */
  async listDirectory(record: ShareRecord, relativePath: string): Promise<DirectoryListing> {
    if (record.kind !== 'directory') throw new Error('Not a directory share');
    const trimmed = (relativePath ?? '').replace(/^\/+/, '');
    const cacheKey = `${record.id}::${trimmed}`;
    const cacheTtl = this.config.directory.listingCacheMs;
    const now = Date.now();
    const cached = this.listingCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.listing;

    const resolved = await this.resolveDirectoryChild(record, trimmed);
    if (resolved.ok !== true) throw new Error(resolved.reason);

    const absDir = resolved.absolutePath;
    const stats = await stat(absDir);
    if (!stats.isDirectory()) throw new Error('not_directory');

    const followSymlinks = record.directory?.followSymlinks ?? false;
    const dirents = await readdir(absDir, { withFileTypes: true });
    const entries: DirectoryListingEntry[] = [];
    let truncated = false;
    const limit = 2_000;

    for (const dirent of dirents) {
      if (entries.length >= limit) {
        truncated = true;
        break;
      }
      const childAbs = resolvePath(absDir, dirent.name);
      try {
        const childLstat = await lstat(childAbs);
        if (childLstat.isSymbolicLink()) {
          if (!followSymlinks) continue;
          const real = await realpath(childAbs);
          if (!isPathUnderWorkspace(record.workspaceRoot, real)) continue;
          const relToShare = relPathPosix(record.absolutePath, real);
          if (relToShare.startsWith('..')) continue;
        }
        const childStat = childLstat.isSymbolicLink() ? await stat(childAbs) : childLstat;
        const childRel = trimmed ? `${trimmed}/${dirent.name}` : dirent.name;
        entries.push({
          name: dirent.name,
          path: childRel,
          isDirectory: childStat.isDirectory(),
          size: childStat.isFile() ? childStat.size : 0,
          mtime: childStat.mtime.toISOString(),
          mimeType: childStat.isDirectory() ? 'application/x-directory' : resolveMimeType(dirent.name),
        });
      } catch {
        /* skip unreadable entries */
      }
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const listing: DirectoryListing = { path: trimmed, entries, truncated };
    if (cacheTtl > 0) {
      this.listingCache.set(cacheKey, { listing, expiresAt: now + cacheTtl });
    }
    return listing;
  }

  /** Drop the listing cache for a share (used on revoke/update). */
  invalidateListingCache(shareId: string): void {
    for (const key of this.listingCache.keys()) {
      if (key.startsWith(`${shareId}::`)) this.listingCache.delete(key);
    }
  }

  revoke(id: string): boolean {
    const record = this.shares.get(id);
    if (!record) return false;
    record.revoked = true;
    this.invalidateListingCache(id);
    this.persistSync();
    logShareAudit(
      'share.revoke',
      { shareId: id, tokenPrefix: record.token.slice(0, 8), fileName: record.fileName },
      `Share revoked: ${record.fileName}`,
    );
    return true;
  }

  revokeMany(ids: string[]): number {
    let count = 0;
    for (const id of ids) {
      const record = this.shares.get(id);
      if (record && !record.revoked) {
        record.revoked = true;
        this.invalidateListingCache(id);
        count++;
        logShareAudit(
          'share.revoke',
          { shareId: id, tokenPrefix: record.token.slice(0, 8), fileName: record.fileName },
          `Share revoked (batch): ${record.fileName}`,
        );
      }
    }
    if (count > 0) this.persistSync();
    return count;
  }

  revokeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const record of this.shares.values()) {
      if (!record.revoked && now >= new Date(record.expiresAt).getTime()) {
        record.revoked = true;
        this.invalidateListingCache(record.id);
        count++;
      }
    }
    if (count > 0) this.persistSync();
    return count;
  }

  update(id: string, patch: { extendTtlMs?: number; maxViews?: number | null }): ShareRecord | null {
    const record = this.shares.get(id);
    if (!record) return null;

    if (patch.extendTtlMs !== undefined) {
      const newExpiry = new Date(Date.now() + patch.extendTtlMs);
      record.expiresAt = newExpiry.toISOString();
    }
    if (patch.maxViews !== undefined) {
      record.maxViews = patch.maxViews;
    }

    this.persistSync();
    logShareAudit(
      'share.update',
      { shareId: id, tokenPrefix: record.token.slice(0, 8), patch },
      `Share updated: ${record.fileName}`,
    );
    return record;
  }

  getActiveShares(): ShareRecord[] {
    const now = Date.now();
    return [...this.shares.values()].filter(
      (r) => !r.revoked && now < new Date(r.expiresAt).getTime(),
    );
  }

  getAllShares(): ShareRecord[] {
    return [...this.shares.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private load(): void {
    const path = resolveSharesPath();
    if (!existsSync(path)) return;
    try {
      const raw = readFileSync(path, 'utf8');
      const data = JSON.parse(raw) as ShareStoreData;
      if (data.version !== 1 || !Array.isArray(data.shares)) return;

      const now = Date.now();
      let cleaned = 0;
      for (const record of data.shares) {
        const expiredMs = now - new Date(record.expiresAt).getTime();
        if (expiredMs > EXPIRED_RETENTION_MS) {
          cleaned++;
          continue;
        }
        this.shares.set(record.id, record);
        this.tokenIndex.set(record.token, record.id);
      }
      if (cleaned > 0) {
        log.info({ cleaned }, `Cleaned ${cleaned} expired share records on load`);
        this.persistSync();
      }
    } catch (err) {
      log.warn({ err }, 'Failed to load shares.json');
    }
  }

  private persistSync(): void {
    const path = resolveSharesPath();
    mkdirSync(resolveStateDir(), { recursive: true });

    let records = [...this.shares.values()];
    if (records.length > MAX_STORED_RECORDS) {
      records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const active = records.filter((r) => !r.revoked && Date.now() < new Date(r.expiresAt).getTime());
      records = active.slice(0, TRUNCATE_TO);

      this.shares.clear();
      this.tokenIndex.clear();
      for (const r of records) {
        this.shares.set(r.id, r);
        this.tokenIndex.set(r.token, r.id);
      }
    }

    const data: ShareStoreData = { version: 1, shares: records };
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }

  private scheduleDebouncedPersist(): void {
    this.dirty = true;
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.dirty) {
        this.dirty = false;
        this.persistSync();
      }
    }, COUNTER_DEBOUNCE_MS);
    this.debounceTimer.unref?.();
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  private cleanupExpired(): void {
    const now = Date.now();
    let removed = 0;
    for (const [id, record] of this.shares) {
      const expiredMs = now - new Date(record.expiresAt).getTime();
      if (expiredMs > EXPIRED_RETENTION_MS) {
        this.shares.delete(id);
        this.tokenIndex.delete(record.token);
        this.invalidateListingCache(id);
        removed++;
      }
    }
    if (removed > 0) {
      this.persistSync();
      log.debug({ removed }, `Cleaned ${removed} expired shares`);
    }
  }

  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.dirty) {
      this.dirty = false;
      this.persistSync();
    }
    this.listingCache.clear();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async resolveAndValidatePath(relPath: string, workspaceRoot: string): Promise<string> {
    const trimmed = relPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!trimmed) throw new Error('Empty path');
    if (trimmed.includes('..')) throw new Error('Path traversal not allowed');
    if (trimmed.includes('\0')) throw new Error('Invalid path');

    const abs = resolvePath(workspaceRoot, trimmed);
    const root = resolvePath(workspaceRoot);
    const relToRoot = relPathPosix(root, abs);
    if (relToRoot.startsWith('..') || relToRoot.split(/[/\\]/).includes('..')) {
      throw new Error('Path is outside workspace');
    }
    return abs;
  }
}

// ── Directory scan helpers ────────────────────────────────────────────────────

async function scanDirectory(
  root: string,
  opts: {
    workspaceRoot: string;
    followSymlinks: boolean;
    maxDepth: number;
    maxFileCount: number;
    maxFolderSize: number;
  },
): Promise<DirectoryScanSummary> {
  let entryCount = 0;
  let totalSize = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > opts.maxDepth) return;
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (entryCount >= opts.maxFileCount) {
        throw new Error(`Folder exceeds maxFileCount (${opts.maxFileCount})`);
      }
      const childAbs = resolvePath(dir, dirent.name);
      const childLstat = await lstat(childAbs);
      let effectiveStat = childLstat;
      if (childLstat.isSymbolicLink()) {
        if (!opts.followSymlinks) continue;
        const real = await realpath(childAbs);
        if (!isPathUnderWorkspace(opts.workspaceRoot, real)) {
          throw new Error('Symlink target escapes workspace');
        }
        effectiveStat = await stat(childAbs);
      }
      if (effectiveStat.isFile()) {
        entryCount++;
        totalSize += effectiveStat.size;
        if (totalSize > opts.maxFolderSize) {
          const maxMb = (opts.maxFolderSize / 1_048_576).toFixed(0);
          throw new Error(`Folder exceeds maxFolderSize (${maxMb} MB)`);
        }
      } else if (effectiveStat.isDirectory()) {
        entryCount++;
        await walk(childAbs, depth + 1);
      }
    }
  }

  await walk(root, 0);
  return { entryCount, totalSize };
}

// ── MIME resolution ─────────────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/typescript',
  xml: 'application/xml',
  csv: 'text/csv',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  wasm: 'application/wasm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  ico: 'image/x-icon',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function resolveMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/** HTTP Content-Type with charset for text-like bodies (browser inline preview). */
export function shareResponseContentType(mime: string): string {
  if (/;\s*charset=/i.test(mime)) return mime;
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/javascript' ||
    mime === 'application/xml' ||
    mime === 'image/svg+xml'
  ) {
    return `${mime}; charset=utf-8`;
  }
  return mime;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let singleton: ShareStore | null = null;

export function getShareStore(config?: Partial<ShareConfig>): ShareStore {
  if (!singleton) singleton = new ShareStore(config);
  return singleton;
}

export function resetShareStoreForTests(): void {
  singleton?.shutdown();
  singleton = null;
}
