import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// macOS `tmpdir()` returns a symlink under `/var/folders/...` whose real path
// lives at `/private/var/folders/...`. The share stores call `realpath()` on
// inputs and then compare against `workspaceRoot` via `isPathUnderWorkspace`,
// which uses `path.resolve` (no symlink following). We canonicalize TEST_DIR
// up-front so both sides agree.
const TEST_DIR_RAW = join(tmpdir(), `xopc-staging-sweep-test-${Date.now()}`);
mkdirSync(TEST_DIR_RAW, { recursive: true });
const TEST_DIR = realpathSync(TEST_DIR_RAW);
const TEST_WORKSPACE = join(TEST_DIR, 'workspace');
const TEST_STATE_DIR = join(TEST_DIR, 'state');

vi.mock('../../config/paths.js', () => ({
  resolveStateDir: () => TEST_STATE_DIR,
}));
vi.mock('../../tunnel/tunnel-state.js', () => ({
  loadTunnelState: () => null,
}));

import {
  forgetStagedSite,
  rememberStagedSite,
  resetStagedSiteRegistryForTests,
  runStagingSweep,
  STAGING_DIR_NAME,
  stageSingleHtmlAsSite,
} from '../share-auto.js';
import { getSiteShareStore } from '../site-share-store.js';

function stagingRoot(): string {
  return join(TEST_WORKSPACE, STAGING_DIR_NAME);
}

function writeHtml(name: string): string {
  const p = join(TEST_WORKSPACE, name);
  writeFileSync(p, `<h1>${name}</h1>`);
  return p;
}

async function createStagedSiteShare(htmlName: string): Promise<{ id: string; stagingDir: string }> {
  const html = writeHtml(htmlName);
  const staged = await stageSingleHtmlAsSite(TEST_WORKSPACE, html);
  const store = getSiteShareStore();
  const rec = await store.create({
    kind: 'static',
    path: staged.relativePath,
    spaFallback: true,
    rewriteMode: 'html-css',
    workspaceRoot: TEST_WORKSPACE,
    gatewayTokenHash: 'test-token-hash',
  });
  rememberStagedSite(rec.id, staged.stagingDir);
  return { id: rec.id, stagingDir: staged.stagingDir };
}

beforeEach(() => {
  mkdirSync(TEST_WORKSPACE, { recursive: true });
  mkdirSync(TEST_STATE_DIR, { recursive: true });
  resetStagedSiteRegistryForTests();
});

afterEach(() => {
  const store = getSiteShareStore();
  // Hard reset: revoke all + drop persisted state dir.
  for (const rec of store.getAllShares()) store.revoke(rec.id);
  store.shutdown();
  // The singleton holds in-memory state; reset by deleting + recreating the
  // store-backed JSON and clearing the staging registry.
  resetStagedSiteRegistryForTests();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('runStagingSweep', () => {
  it('keeps staging dirs that have a live record', async () => {
    const { stagingDir } = await createStagedSiteShare('keep.html');
    expect(existsSync(stagingDir)).toBe(true);

    await runStagingSweep();

    expect(existsSync(stagingDir)).toBe(true);
  });

  it('removes orphan staging dirs (no matching record on disk)', async () => {
    // Manually create an "orphan" dir that no SiteShareRecord knows about.
    const orphan = join(stagingRoot(), 'manual-orphan-uuid');
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(orphan, 'index.html'), '<h1>orphan</h1>');
    expect(existsSync(orphan)).toBe(true);

    await runStagingSweep();

    expect(existsSync(orphan)).toBe(false);
  });

  it('keeps the live dir AND drops the orphan in one sweep', async () => {
    const { stagingDir } = await createStagedSiteShare('live.html');
    const orphan = join(stagingRoot(), 'manual-orphan-2');
    mkdirSync(orphan, { recursive: true });

    await runStagingSweep();

    expect(existsSync(stagingDir)).toBe(true);
    expect(existsSync(orphan)).toBe(false);
  });

  it('no-op when staging dir does not exist', async () => {
    await expect(runStagingSweep()).resolves.toBeUndefined();
  });

  it('re-registers staged dirs into the in-process map so post-restart revoke cleans them', async () => {
    const { id, stagingDir } = await createStagedSiteShare('reregister.html');
    // Simulate a process restart: drop the in-memory registry but leave the
    // SiteShareStore persisted record + the on-disk staging dir.
    resetStagedSiteRegistryForTests();
    expect(forgetStagedSite(id)).toBeUndefined(); // registry is empty

    await runStagingSweep();

    // After sweep, the registry should know about the staging dir again.
    expect(forgetStagedSite(id)).toBe(stagingDir);
  });
});
