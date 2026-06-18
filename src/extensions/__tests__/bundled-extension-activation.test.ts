import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import type { ExtensionManifest } from '../types/index.js';
import { computeBundledExtensionExtensionsPatch } from '../bundled-extension-activation.js';
import { ExtensionLoader } from '../loader.js';

describe('computeBundledExtensionExtensionsPatch', () => {
  it('returns error for unknown extension id', () => {
    const loader = new ExtensionLoader();
    const cfg = { extensions: {} } as Config;
    const r = computeBundledExtensionExtensionsPatch(
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
