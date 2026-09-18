import { describe, expect, it } from 'vitest';

import { normalizeUiManifest } from '../normalize-manifest.js';

describe('extension UI manifest contract', () => {
  it('keeps only permissions implemented by the host', () => {
    const ui = normalizeUiManifest({
      permissions: ['theme', 'config.read', 'clipboard', 'workspace.read'],
    });
    expect(ui?.permissions).toEqual(['theme', 'config.read']);
  });

  it('drops unsupported contribution points and when fields', () => {
    const ui = normalizeUiManifest({
      contributions: {
        sidebarPanels: [{ id: 'side', title: 'Side', entrypoint: 'side.html' }],
        statusBarItems: [{ id: 'status', entrypoint: 'status.html' }],
        pages: [{ id: 'page', title: 'Page', path: 'page', entrypoint: 'page.html', when: 'x' }],
      },
    });
    expect(ui?.contributions).toEqual({
      pages: [{ id: 'page', title: 'Page', path: 'page', entrypoint: 'page.html', showInNav: undefined, navIcon: undefined }],
    });
  });
});
