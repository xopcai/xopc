import { describe, expect, it } from 'vitest';

import {
  cloakBrowserArchiveDownloadUrls,
  listCloakBrowserPlatforms,
} from '../providers/cloakbrowser.js';

describe('cloakBrowserArchiveDownloadUrls', () => {
  it('prefers xopc.ai proxy before GitHub and cloakbrowser.dev', () => {
    const darwin = listCloakBrowserPlatforms().find((p) => p.tag === 'darwin-arm64');
    expect(darwin).toBeDefined();
    const urls = cloakBrowserArchiveDownloadUrls(darwin!);
    expect(urls[0]).toBe(
      'https://xopc.ai/api/cloakbrowser/download/cloakbrowser-darwin-arm64.tar.gz',
    );
    expect(urls[1]).toContain('github.com/CloakHQ/CloakBrowser/releases/download');
    expect(urls[2]).toBe('https://cloakbrowser.dev/download/cloakbrowser-darwin-arm64.tar.gz');
  });

  it('uses zip extension for windows-x64', () => {
    const win = listCloakBrowserPlatforms().find((p) => p.tag === 'windows-x64');
    expect(win).toBeDefined();
    const urls = cloakBrowserArchiveDownloadUrls(win!);
    expect(urls[0]).toBe(
      'https://xopc.ai/api/cloakbrowser/download/cloakbrowser-windows-x64.zip',
    );
  });
});
