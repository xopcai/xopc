import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { existsSync, readFileSync, rmSync as _rmSync } from 'node:fs';

import {
  audienceDefaults,
  cleanupStagedSite,
  decideShareKind,
  forgetStagedSite,
  makeDescription,
  makeTitle,
  probeShareTarget,
  rememberStagedSite,
  resetStagedSiteRegistryForTests,
  STAGING_DIR_NAME,
  stageSingleHtmlAsSite,
} from '../share-auto.js';

void _rmSync;

const TEST_DIR = join(tmpdir(), `xopc-share-auto-test-${Date.now()}`);
const TEST_WORKSPACE = join(TEST_DIR, 'workspace');

beforeEach(() => {
  mkdirSync(TEST_WORKSPACE, { recursive: true });
});
afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function write(rel: string, body = 'x'): void {
  const p = join(TEST_WORKSPACE, rel);
  const dir = p.substring(0, p.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(p, body);
}

describe('audienceDefaults', () => {
  it('friend: 3d, unlimited views', () => {
    expect(audienceDefaults('friend')).toEqual({ ttlMs: 3 * 86_400_000, maxViews: null });
  });
  it('colleague: 7d, unlimited', () => {
    expect(audienceDefaults('colleague')).toEqual({ ttlMs: 7 * 86_400_000, maxViews: null });
  });
  it('public: 1d, capped at 100', () => {
    expect(audienceDefaults('public')).toEqual({ ttlMs: 86_400_000, maxViews: 100 });
  });
  it('undefined → friend', () => {
    expect(audienceDefaults(undefined)).toEqual({ ttlMs: 3 * 86_400_000, maxViews: null });
  });
});

describe('decideShareKind', () => {
  const baseProbe = {
    absolutePath: '/x',
    kind: 'file' as const,
    size: 1000,
    mimeType: 'application/octet-stream',
    hasIndexHtml: false,
  };

  it('single HTML → site', () => {
    const d = decideShareKind({ ...baseProbe, mimeType: 'text/html' }, 'auto');
    expect(d.kind).toBe('site');
    expect(d.reason).toBe('html-single-file');
  });

  it('directory with index.html → site', () => {
    const d = decideShareKind({ ...baseProbe, kind: 'directory', mimeType: 'application/x-directory', hasIndexHtml: true }, 'auto');
    expect(d.kind).toBe('site');
    expect(d.reason).toBe('html-with-assets');
  });

  it('directory without index.html → file/browse', () => {
    const d = decideShareKind({ ...baseProbe, kind: 'directory', mimeType: 'application/x-directory' }, 'auto');
    expect(d.kind).toBe('file');
    expect(d.reason).toBe('directory-browse');
  });

  it('small image → file', () => {
    const d = decideShareKind({ ...baseProbe, mimeType: 'image/png', size: 500_000 }, 'auto');
    expect(d.kind).toBe('file');
    expect(d.reason).toBe('small-image');
  });

  it('large binary → file/download', () => {
    const d = decideShareKind({ ...baseProbe, mimeType: 'application/zip', size: 80_000_000 }, 'auto');
    expect(d.kind).toBe('file');
    expect(d.reason).toBe('large-binary');
  });

  it('force-site on a binary file throws', () => {
    expect(() =>
      decideShareKind({ ...baseProbe, mimeType: 'application/zip' }, 'force-site'),
    ).toThrow(/force-site requires/);
  });

  it('force-zip on a single file throws', () => {
    expect(() => decideShareKind({ ...baseProbe }, 'force-zip')).toThrow(/force-zip requires/);
  });

  it('force-file on directory becomes zip', () => {
    const d = decideShareKind({ ...baseProbe, kind: 'directory' }, 'force-file');
    expect(d.kind).toBe('zip');
    expect(d.reason).toBe('forced');
  });
});

describe('probeShareTarget', () => {
  it('detects file + mime', async () => {
    write('hello.html', '<h1>hi</h1>');
    const p = await probeShareTarget(TEST_WORKSPACE, 'hello.html');
    expect(p.kind).toBe('file');
    expect(p.mimeType).toBe('text/html');
    expect(p.size).toBeGreaterThan(0);
  });

  it('detects directory + hasIndexHtml', async () => {
    write('site/index.html', '<html/>');
    write('site/style.css', 'body{}');
    const p = await probeShareTarget(TEST_WORKSPACE, 'site');
    expect(p.kind).toBe('directory');
    expect(p.hasIndexHtml).toBe(true);
  });

  it('rejects path traversal', async () => {
    await expect(probeShareTarget(TEST_WORKSPACE, '../escape')).rejects.toThrow();
  });
});

describe('stageSingleHtmlAsSite', () => {
  beforeEach(() => resetStagedSiteRegistryForTests());

  it('copies the HTML to <workspace>/.xopc-share-staging/<uuid>/index.html', async () => {
    write('plan.html', '<h1>my plan</h1>');
    const probe = await probeShareTarget(TEST_WORKSPACE, 'plan.html');
    const staged = await stageSingleHtmlAsSite(TEST_WORKSPACE, probe.absolutePath);

    expect(staged.relativePath.startsWith(`${STAGING_DIR_NAME}/`)).toBe(true);
    expect(staged.stagingDir.includes(STAGING_DIR_NAME)).toBe(true);

    const copied = `${staged.stagingDir}/index.html`;
    expect(existsSync(copied)).toBe(true);
    expect(readFileSync(copied, 'utf8')).toBe('<h1>my plan</h1>');
  });

  it('cleanupStagedSite removes the staged dir', async () => {
    write('plan.html', '<h1>hi</h1>');
    const probe = await probeShareTarget(TEST_WORKSPACE, 'plan.html');
    const staged = await stageSingleHtmlAsSite(TEST_WORKSPACE, probe.absolutePath);
    await cleanupStagedSite(staged.stagingDir);
    expect(existsSync(staged.stagingDir)).toBe(false);
  });

  it('cleanupStagedSite refuses paths outside the staging folder', async () => {
    // Create a regular directory outside staging, ask cleanup — must NOT delete it.
    write('safe/keep.txt', 'do not delete');
    await cleanupStagedSite(`${TEST_WORKSPACE}/safe`);
    expect(existsSync(`${TEST_WORKSPACE}/safe/keep.txt`)).toBe(true);
  });

  it('staging registry remember/forget round-trip', () => {
    rememberStagedSite('rec-1', '/tmp/.xopc-share-staging/x');
    expect(forgetStagedSite('rec-1')).toBe('/tmp/.xopc-share-staging/x');
    expect(forgetStagedSite('rec-1')).toBeUndefined();
  });
});

describe('makeTitle / makeDescription', () => {
  it('strips file extension', () => {
    expect(makeTitle('plan.html')).toBe('plan');
  });
  it('keeps override', () => {
    expect(makeTitle('plan.html', '我的计划')).toBe('我的计划');
  });
  it('clips long title', () => {
    expect(makeTitle('a'.repeat(80))).toHaveLength(60);
  });
  it('description has xopc + audience hint', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const d = makeDescription({ audience: 'friend', expiresAt: tomorrow });
    expect(d).toContain('好友');
    expect(d).toContain('xopc');
  });
});
