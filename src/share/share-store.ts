import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stat, lstat, realpath } from 'node:fs/promises';

import { resolveStateDir } from '../config/paths.js';
import { isPathUnderWorkspace } from '../gateway/workspace-editor-path.js';
import { createLogger } from '../utils/logger.js';
import { logShareAudit } from './share-audit.js';
import type { ShareRecord, ShareStoreData, ShareConfig, CreateShareParams } from './share-types.js';
import { SHARE_CONFIG_DEFAULTS } from './share-types.js';

const log = createLogger('ShareStore');

const SHARES_FILE = 'shares.json';
const CLEANUP_INTERVAL_MS = 10 * 60_000;
const EXPIRED_RETENTION_MS = 24 * 60 * 60_000;
const MAX_STORED_RECORDS = 500;
const TRUNCATE_TO = 200;
const VIEW_COUNT_DEBOUNCE_MS = 2_000;

function resolveSharesPath(): string {
  return join(resolveStateDir(), SHARES_FILE);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 12);
}

export class ShareStore {
  private shares = new Map<string, ShareRecord>();
  private tokenIndex = new Map<string, string>();
  private viewCountDirty = false;
  private viewCountTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private config: ShareConfig;

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

  async create(params: CreateShareParams & {
    workspaceRoot: string;
    gatewayTokenHash: string;
  }): Promise<ShareRecord> {
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

    if (!fileStat.isFile()) {
      throw new Error('Path is not a regular file');
    }
    if (fileStat.size > this.config.maxFileSize) {
      const maxMb = (this.config.maxFileSize / 1_048_576).toFixed(0);
      throw new Error(`File size exceeds maximum (${maxMb} MB)`);
    }

    const linkStat = await lstat(absolutePath);
    if (linkStat.isSymbolicLink()) {
      const realPath = await realpath(absolutePath);
      if (!isPathUnderWorkspace(workspaceRoot, realPath)) {
        throw new Error('Symlink target is outside workspace');
      }
    }

    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const fileName = relPath.split('/').pop() ?? relPath;
    const mimeType = resolveMimeType(fileName);
    const now = new Date();

    const record: ShareRecord = {
      id,
      token,
      absolutePath,
      workspaceRelativePath: relPath,
      workspaceRoot,
      inode: fileStat.ino,
      isDirectory: false,
      fileName,
      fileSize: fileStat.size,
      mimeType,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      maxViews: params.maxViews ?? null,
      viewCount: 0,
      revoked: false,
      createdByTokenHash: gatewayTokenHash,
      description: params.description,
    };

    this.shares.set(id, record);
    this.tokenIndex.set(token, id);
    this.persistSync();

    logShareAudit(
      'share.create',
      { shareId: id, tokenPrefix: token.slice(0, 8), fileName, fileSize: fileStat.size, ttlMs },
      `Share created: ${fileName}`,
    );

    return record;
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
    if (record.maxViews !== null && record.viewCount >= record.maxViews) {
      return { valid: false, reason: 'max_views' };
    }
    return { valid: true };
  }

  /** Increment view count (debounced persist). */
  incrementViewCount(id: string): void {
    const record = this.shares.get(id);
    if (!record) return;
    record.viewCount++;
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
          { shareId: record.id, tokenPrefix: record.token.slice(0, 8), oldInode: record.inode, newInode: fileStat.ino },
          `Share file replaced (inode changed): ${record.fileName}`,
        );
        return { valid: false, reason: 'file_deleted' };
      }
      return { valid: true };
    } catch {
      return { valid: false, reason: 'file_deleted' };
    }
  }

  revoke(id: string): boolean {
    const record = this.shares.get(id);
    if (!record) return false;
    record.revoked = true;
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
    this.viewCountDirty = true;
    if (this.viewCountTimer) return;
    this.viewCountTimer = setTimeout(() => {
      this.viewCountTimer = null;
      if (this.viewCountDirty) {
        this.viewCountDirty = false;
        this.persistSync();
      }
    }, VIEW_COUNT_DEBOUNCE_MS);
    this.viewCountTimer.unref?.();
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
    if (this.viewCountTimer) {
      clearTimeout(this.viewCountTimer);
      this.viewCountTimer = null;
    }
    if (this.viewCountDirty) {
      this.viewCountDirty = false;
      this.persistSync();
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async resolveAndValidatePath(relPath: string, workspaceRoot: string): Promise<string> {
    const trimmed = relPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!trimmed) throw new Error('Empty path');
    if (trimmed.includes('..')) throw new Error('Path traversal not allowed');
    if (trimmed.includes('\0')) throw new Error('Invalid path');

    const { resolve } = await import('node:path');
    const { relative } = await import('node:path');

    const abs = resolve(workspaceRoot, trimmed);
    const root = resolve(workspaceRoot);
    const relToRoot = relative(root, abs);
    if (relToRoot.startsWith('..') || relToRoot.split(/[/\\]/).includes('..')) {
      throw new Error('Path is outside workspace');
    }
    return abs;
  }
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
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function resolveMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] || 'application/octet-stream';
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
