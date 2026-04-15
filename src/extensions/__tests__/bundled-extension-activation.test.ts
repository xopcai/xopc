import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
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
