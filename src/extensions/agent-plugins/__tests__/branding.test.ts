import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { it, expect } from 'vitest';
import { pluginBranding } from '../branding.js';
import type { PluginManifest } from '../validation.js';

it('loads a contained icon offline and rejects unsafe or escaping package assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'plugin-icons-'));
  const manifest = (icon: string) => ({ name: 'icon', extensions: { 'ai.xopc': { branding: { icon } } } }) as PluginManifest;
  try {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h4v4z"/></svg>');
    const icon = pluginBranding(root, manifest('assets/icon.svg'));
    expect(icon?.iconUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(icon?.iconSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pluginBranding(root, manifest('../outside.svg'))).toBeUndefined();
    symlinkSync(tmpdir(), join(root, 'assets/outside'));
    expect(pluginBranding(root, manifest('assets/outside/outside.svg'))).toBeUndefined();
    writeFileSync(join(root, 'assets/icon.svg'), '<svg><script>alert(1)</script></svg>');
    expect(pluginBranding(root, manifest('assets/icon.svg'))).toBeUndefined();
    writeFileSync(join(root, 'assets/icon.svg'), '<svg><image href="https://example.com/tracker"/></svg>');
    expect(pluginBranding(root, manifest('assets/icon.svg'))).toBeUndefined();
    writeFileSync(join(root, 'assets/icon.svg'), 'x'.repeat(129 * 1024));
    expect(pluginBranding(root, manifest('assets/icon.svg'))).toBeUndefined();
    writeFileSync(join(root, 'assets/icon.png'), 'not a PNG');
    expect(pluginBranding(root, manifest('assets/icon.png'))).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
