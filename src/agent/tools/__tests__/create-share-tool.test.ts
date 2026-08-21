import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `xopc-create-share-tool-${Date.now()}`);
const TEST_WORKSPACE = join(TEST_DIR, 'workspace');
const TEST_STATE_DIR = join(TEST_DIR, 'state');

vi.mock('../../../config/paths.js', async () => {
  const actual = await vi.importActual<typeof import('../../../config/paths.js')>('../../../config/paths.js');
  return { ...actual, resolveStateDir: () => TEST_STATE_DIR };
});
vi.mock('../../../tunnel/tunnel-state.js', () => ({ loadTunnelState: () => null }));
vi.mock('../../../share/share-thumbnail.js', () => ({
  scheduleThumbnail: vi.fn(() => 'pending'),
}));

import { createCreateShareTool, isShareToolAvailable } from '../create-share-tool.js';
import { resetShareStoreForTests } from '../../../share/share-store.js';
import { resetStagedSiteRegistryForTests } from '../../../share/share-auto.js';

const fakeConfig = {
  gateway: {
    bind: 'loopback' as const,
    port: 18790,
    auth: { mode: 'token' as const },
    heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
    corsOrigins: [],
  },
};

beforeEach(() => {
  resetShareStoreForTests();
  resetStagedSiteRegistryForTests();
  mkdirSync(TEST_WORKSPACE, { recursive: true });
  mkdirSync(TEST_STATE_DIR, { recursive: true });
});
afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  resetShareStoreForTests();
  resetStagedSiteRegistryForTests();
});

function write(rel: string, body = 'x'): void {
  const p = join(TEST_WORKSPACE, rel);
  const dir = dirname(p);
  mkdirSync(dir, { recursive: true });
  writeFileSync(p, body);
}

describe('create_share tool', () => {
  it('exposes the expected name + schema fields', () => {
    const tool = createCreateShareTool({
      workspace: TEST_WORKSPACE,
      getConfig: () => fakeConfig as any,
    });
    expect(tool.name).toBe('create_share');
    const params = (tool as any).parameters;
    expect(params).toBeDefined();
    const propKeys = Object.keys(params.properties);
    expect(propKeys).toContain('filePath');
    expect(propKeys).toContain('audience');
    expect(propKeys).toContain('mode');
  });

  it('creates a file share for a plain text file', async () => {
    write('hello.txt', 'world');
    const tool = createCreateShareTool({
      workspace: TEST_WORKSPACE,
      getConfig: () => fakeConfig as any,
    });
    const res = await (tool as any).execute('call-1', { filePath: 'hello.txt' });
    expect(res.details.kind).toBe('file');
    expect(res.details.shareUrl).toContain('/s/');
    expect(res.details.thumbnailUrl).toContain('/thumbnail');
    expect(res.details.reachability).toBe('local-only');
  });

  it('renders text in zh when getLocale returns zh', async () => {
    write('hello.txt', 'world');
    const tool = createCreateShareTool({
      workspace: TEST_WORKSPACE,
      getConfig: () => fakeConfig as any,
      getLocale: () => 'zh-CN',
    });
    const res = await (tool as any).execute('call-1', { filePath: 'hello.txt' });
    const text = res.content[0].text as string;
    expect(text).toContain('分享链接已生成');
    expect(text).toContain('标题：');
    expect(text).toContain('当前可达性'); // local-only triggers warning
  });

  it('renders text in en when getLocale returns en', async () => {
    write('hello.txt', 'world');
    const tool = createCreateShareTool({
      workspace: TEST_WORKSPACE,
      getConfig: () => fakeConfig as any,
      getLocale: () => 'en',
    });
    const res = await (tool as any).execute('call-1', { filePath: 'hello.txt' });
    const text = res.content[0].text as string;
    expect(text).toContain('Share link created');
    expect(text).toContain('Title:');
    expect(text).toContain('Current reachability');
  });

  it('error message also localizes (zh)', async () => {
    const tool = createCreateShareTool({
      workspace: TEST_WORKSPACE,
      getConfig: () => fakeConfig as any,
      getLocale: () => 'zh',
    });
    const res = await (tool as any).execute('call-1', { filePath: '/etc/hosts' });
    expect(res.content[0].text).toContain('create_share 失败');
  });

  it('rejects paths outside the workspace', async () => {
    const tool = createCreateShareTool({
      workspace: TEST_WORKSPACE,
      getConfig: () => fakeConfig as any,
    });
    const res = await (tool as any).execute('call-1', { filePath: '/etc/hosts' });
    expect(res.details.error).toMatch(/inside the agent workspace/i);
  });

  it('rejects an empty / workspace-root path', async () => {
    const tool = createCreateShareTool({
      workspace: TEST_WORKSPACE,
      getConfig: () => fakeConfig as any,
    });
    const res = await (tool as any).execute('call-1', { filePath: '.' });
    expect(res.details.error).toBeDefined();
  });
});

describe('isShareToolAvailable', () => {
  it('returns false when config is missing', () => {
    expect(isShareToolAvailable(undefined)).toBe(false);
  });

  it('returns false when gateway section is missing', () => {
    expect(isShareToolAvailable({} as any)).toBe(false);
  });

  it('defaults to true when gateway is present and share toggles are omitted', () => {
    expect(isShareToolAvailable(fakeConfig as any)).toBe(true);
  });

  it('still true when only file share is enabled', () => {
    const cfg = { gateway: { ...fakeConfig.gateway, share: { enabled: true }, siteShare: { enabled: false } } };
    expect(isShareToolAvailable(cfg as any)).toBe(true);
  });

  it('still true when only site share is enabled', () => {
    const cfg = { gateway: { ...fakeConfig.gateway, share: { enabled: false }, siteShare: { enabled: true } } };
    expect(isShareToolAvailable(cfg as any)).toBe(true);
  });

  it('returns false when BOTH are explicitly disabled', () => {
    const cfg = { gateway: { ...fakeConfig.gateway, share: { enabled: false }, siteShare: { enabled: false } } };
    expect(isShareToolAvailable(cfg as any)).toBe(false);
  });
});
