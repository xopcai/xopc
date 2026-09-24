import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import type { Config } from '../../config/schema.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import type { ExtensionManifest } from '../types/index.js';
import { computeExtensionActivationPatch } from '../bundled-extension-activation.js';
import { ExtensionLoader } from '../loader.js';

beforeAll(() => initializeTestAgentCatalog());
afterAll(() => closeXopcDatabase());

describe('computeExtensionActivationPatch', () => {
  it('returns error for unknown extension id', () => {
    const loader = new ExtensionLoader();
    const cfg = { extensions: {} } as Config;
    const r = computeExtensionActivationPatch(
      loader,
      cfg,
      'definitely-not-an-extension-xyz',
      true,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/not found/i);
    }
  });

  it('can disable and re-enable a user-installed extension', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-extension-activation-'));
    try {
      const extensionDir = join(root, 'sample-user-extension');
      mkdirSync(extensionDir);
      writeFileSync(join(extensionDir, 'xopc.extension.json'), JSON.stringify({
        id: 'sample-user-extension',
        name: 'Sample user extension',
        version: '1.0.0',
        entry: 'index.js',
      }));
      const loader = new ExtensionLoader({
        extensionsDir: root,
        workspaceExtensionsDir: join(root, 'workspace'),
      });

      const disabled = computeExtensionActivationPatch(
        loader,
        { extensions: {} } as Config,
        'sample-user-extension',
        false,
      );
      expect(disabled).toEqual({
        ok: true,
        extensions: { disabled: ['sample-user-extension'] },
      });

      const enabled = computeExtensionActivationPatch(
        loader,
        { extensions: disabled.ok ? disabled.extensions : {} } as Config,
        'sample-user-extension',
        true,
      );
      expect(enabled).toEqual({
        ok: true,
        extensions: { enabled: ['sample-user-extension'] },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('ExtensionLoader slot claims', () => {
  it('does not treat image generation providers as exclusive slots', () => {
    const loader = new ExtensionLoader();
    const claimExtensionSlots = (
      loader as unknown as {
        claimExtensionSlots(extensionId: string, manifest: ExtensionManifest): boolean;
      }
    ).claimExtensionSlots.bind(loader);

    const manifest = {
      id: 'dashscope',
      name: 'DashScope',
      version: '0.0.0',
      kind: 'image-generation',
      entry: 'index.js',
    } as ExtensionManifest;

    expect(claimExtensionSlots('dashscope', manifest)).toBe(true);
    expect(claimExtensionSlots('minimax', { ...manifest, id: 'minimax', name: 'MiniMax' })).toBe(true);
  });
});
