import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { ShareStore, resetShareStoreForTests, resolveMimeType, shareResponseContentType } from '../share-store.js';

const TEST_DIR = join(tmpdir(), `xopc-share-test-${Date.now()}`);
const TEST_WORKSPACE = join(TEST_DIR, 'workspace');
const TEST_STATE_DIR = join(TEST_DIR, 'state');

vi.mock('../../config/paths.js', () => ({
  resolveStateDir: () => TEST_STATE_DIR,
}));

vi.mock('../../tunnel/tunnel-state.js', () => ({
  loadTunnelState: () => null,
}));

function createTestFile(name: string, content = 'test content'): string {
  const filePath = join(TEST_WORKSPACE, name);
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content);
  return filePath;
}

describe('ShareStore', () => {
  let store: ShareStore;

  beforeEach(() => {
    resetShareStoreForTests();
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mkdirSync(TEST_STATE_DIR, { recursive: true });
    store = new ShareStore({
      enabled: true,
      defaultTtlMs: 86_400_000,
      maxTtlMs: 604_800_000,
      maxActiveShares: 100,
      maxFileSize: 104_857_600,
      inlinePreviewMimes: ['image/png', 'application/pdf'],
    });
  });

  afterEach(() => {
    store.shutdown();
    resetShareStoreForTests();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('create', () => {
    it('should create a share for a valid file', async () => {
      createTestFile('hello.txt');
      const record = await store.create({
        path: 'hello.txt',
        workspaceRoot: TEST_WORKSPACE,
        gatewayTokenHash: 'abc123def456',
      });

      expect(record.id).toBeDefined();
      expect(record.token).toBeDefined();
      expect(record.token.length).toBeGreaterThan(40);
      expect(record.fileName).toBe('hello.txt');
      expect(record.mimeType).toBe('text/plain');
      expect(record.downloadCount).toBe(0);
      expect(record.revoked).toBe(false);
      expect(record.workspaceRelativePath).toBe('hello.txt');
    });

    it('should reject path traversal', async () => {
      createTestFile('hello.txt');
      await expect(
        store.create({
          path: '../etc/passwd',
          workspaceRoot: TEST_WORKSPACE,
          gatewayTokenHash: 'abc123def456',
        }),
      ).rejects.toThrow('Path traversal not allowed');
    });

    it('should reject empty path', async () => {
      await expect(
        store.create({
          path: '',
          workspaceRoot: TEST_WORKSPACE,
          gatewayTokenHash: 'abc123def456',
        }),
      ).rejects.toThrow('Empty path');
    });

    it('should reject non-existent file', async () => {
      await expect(
        store.create({
          path: 'does-not-exist.txt',
          workspaceRoot: TEST_WORKSPACE,
          gatewayTokenHash: 'abc123def456',
        }),
      ).rejects.toThrow();
    });

    it('should reject invalid TTL', async () => {
      createTestFile('hello.txt');
      await expect(
        store.create({
          path: 'hello.txt',
          ttlMs: 1000,
          workspaceRoot: TEST_WORKSPACE,
          gatewayTokenHash: 'abc123def456',
        }),
      ).rejects.toThrow('TTL must be');
    });

    it('should reject when sharing is disabled', async () => {
      store.updateConfig({ enabled: false });
      createTestFile('hello.txt');
      await expect(
        store.create({
          path: 'hello.txt',
          workspaceRoot: TEST_WORKSPACE,
          gatewayTokenHash: 'abc123def456',
        }),
      ).rejects.toThrow('File sharing is disabled');
    });
  });

  describe('getByToken / getById', () => {
    it('should retrieve share by token', async () => {
      createTestFile('file.pdf');
      const created = await store.create({
        path: 'file.pdf',
        workspaceRoot: TEST_WORKSPACE,
        gatewayTokenHash: 'abc123def456',
      });

      const byToken = store.getByToken(created.token);
      expect(byToken).not.toBeNull();
      expect(byToken!.id).toBe(created.id);

      const byId = store.getById(created.id);
      expect(byId).not.toBeNull();
      expect(byId!.token).toBe(created.token);
    });

    it('should return null for unknown token', () => {
      expect(store.getByToken('nonexistent')).toBeNull();
    });
  });

  describe('validateAccess', () => {
    it('should be valid for fresh share', async () => {
      createTestFile('file.txt');
      const record = await store.create({
        path: 'file.txt',
        workspaceRoot: TEST_WORKSPACE,
        gatewayTokenHash: 'abc123def456',
      });
      expect(store.validateAccess(record)).toEqual({ valid: true });
    });

    it('should reject revoked share', async () => {
      createTestFile('file.txt');
      const record = await store.create({
        path: 'file.txt',
        workspaceRoot: TEST_WORKSPACE,
        gatewayTokenHash: 'abc123def456',
      });
      store.revoke(record.id);
      const updated = store.getById(record.id)!;
      expect(store.validateAccess(updated)).toEqual({ valid: false, reason: 'revoked' });
    });

    it('should reject when maxViews exceeded', async () => {
      createTestFile('file.txt');
      const record = await store.create({
        path: 'file.txt',
        maxViews: 1,
        workspaceRoot: TEST_WORKSPACE,
        gatewayTokenHash: 'abc123def456',
      });
      store.incrementDownloadCount(record.id);
      const updated = store.getById(record.id)!;
      expect(store.validateAccess(updated)).toEqual({ valid: false, reason: 'max_views' });
    });
  });

  describe('revoke', () => {
    it('should revoke a share', async () => {
      createTestFile('file.txt');
      const record = await store.create({
        path: 'file.txt',
        workspaceRoot: TEST_WORKSPACE,
        gatewayTokenHash: 'abc123def456',
      });
      const result = store.revoke(record.id);
      expect(result).toBe(true);
      expect(store.getById(record.id)!.revoked).toBe(true);
    });

    it('should return false for unknown id', () => {
      expect(store.revoke('nonexistent')).toBe(false);
    });
  });

  describe('revokeMany', () => {
    it('should revoke multiple shares', async () => {
      createTestFile('a.txt');
      createTestFile('b.txt');
      const a = await store.create({ path: 'a.txt', workspaceRoot: TEST_WORKSPACE, gatewayTokenHash: 'x' });
      const b = await store.create({ path: 'b.txt', workspaceRoot: TEST_WORKSPACE, gatewayTokenHash: 'x' });
      const count = store.revokeMany([a.id, b.id]);
      expect(count).toBe(2);
    });
  });

  describe('update', () => {
    it('should extend TTL', async () => {
      createTestFile('file.txt');
      const record = await store.create({
        path: 'file.txt',
        ttlMs: 60_000, // 1 minute — so extending by 24h is clearly longer
        workspaceRoot: TEST_WORKSPACE,
        gatewayTokenHash: 'abc123def456',
      });
      const before = new Date(record.expiresAt).getTime();
      const updated = store.update(record.id, { extendTtlMs: 86_400_000 });
      expect(updated).not.toBeNull();
      const after = new Date(updated!.expiresAt).getTime();
      // extendTtlMs calculates from Date.now(), so the new expiry should be
      // at least ~86_400_000ms from now, which is far beyond the original 60s TTL.
      expect(after).toBeGreaterThan(before);
    });

    it('should update maxViews', async () => {
      createTestFile('file.txt');
      const record = await store.create({
        path: 'file.txt',
        workspaceRoot: TEST_WORKSPACE,
        gatewayTokenHash: 'abc123def456',
      });
      const updated = store.update(record.id, { maxViews: 50 });
      expect(updated!.maxViews).toBe(50);
    });
  });

  describe('persistence', () => {
    it('should persist and reload shares', async () => {
      createTestFile('persist.txt');
      const record = await store.create({
        path: 'persist.txt',
        workspaceRoot: TEST_WORKSPACE,
        gatewayTokenHash: 'abc123def456',
      });
      store.shutdown();

      const store2 = new ShareStore();
      const loaded = store2.getById(record.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.fileName).toBe('persist.txt');
      store2.shutdown();
    });
  });

  describe('getActiveShares', () => {
    it('should only return non-revoked, non-expired shares', async () => {
      createTestFile('active.txt');
      createTestFile('revoked.txt');
      await store.create({ path: 'active.txt', workspaceRoot: TEST_WORKSPACE, gatewayTokenHash: 'x' });
      const r = await store.create({ path: 'revoked.txt', workspaceRoot: TEST_WORKSPACE, gatewayTokenHash: 'x' });
      store.revoke(r.id);

      const active = store.getActiveShares();
      expect(active.length).toBe(1);
      expect(active[0].fileName).toBe('active.txt');
    });
  });
});

describe('shareResponseContentType', () => {
  it('adds charset=utf-8 for markdown and other text-like MIME types', () => {
    expect(shareResponseContentType(resolveMimeType('notes.md'))).toBe('text/markdown; charset=utf-8');
    expect(shareResponseContentType('text/plain')).toBe('text/plain; charset=utf-8');
    expect(shareResponseContentType('application/json')).toBe('application/json; charset=utf-8');
  });

  it('leaves binary MIME types unchanged', () => {
    expect(shareResponseContentType('image/png')).toBe('image/png');
    expect(shareResponseContentType('application/pdf')).toBe('application/pdf');
  });

  it('does not duplicate charset', () => {
    expect(shareResponseContentType('text/html; charset=utf-8')).toBe('text/html; charset=utf-8');
  });
});
