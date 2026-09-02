import { describe, expect, it } from 'vitest';

import {
  buildHtmlWebViewSource,
  isHtmlFile,
  shouldAllowHtmlWebViewNavigation,
} from '../html-preview-source';

describe('isHtmlFile', () => {
  it('detects html extensions and mime type', () => {
    expect(isHtmlFile('guide.html', 'text/html')).toBe(true);
    expect(isHtmlFile('page.htm', 'text/plain')).toBe(true);
    expect(isHtmlFile('readme.md', 'text/html')).toBe(true);
    expect(isHtmlFile('readme.md', 'text/markdown')).toBe(false);
  });
});

describe('buildHtmlWebViewSource', () => {
  it('renders managed HTML content inline', () => {
    expect(
      buildHtmlWebViewSource({
        htmlContent: '<html><body>Hi</body></html>',
        gatewayBaseUrl: 'http://gateway.test/',
      }),
    ).toEqual({
      html: '<html><body>Hi</body></html>',
      baseUrl: 'http://gateway.test/',
    });
  });
});

describe('shouldAllowHtmlWebViewNavigation', () => {
  const previewUri = 'http://gateway.test/api/files/resource/content';

  it('allows preview and gateway URLs', () => {
    expect(shouldAllowHtmlWebViewNavigation(previewUri, previewUri, 'http://gateway.test')).toBe(true);
    expect(
      shouldAllowHtmlWebViewNavigation(
        'http://gateway.test/api/files/styles/content',
        previewUri,
        'http://gateway.test',
      ),
    ).toBe(true);
    expect(shouldAllowHtmlWebViewNavigation('about:blank', previewUri, 'http://gateway.test')).toBe(true);
  });

  it('blocks external URLs for in-app handling', () => {
    expect(
      shouldAllowHtmlWebViewNavigation('https://example.com', previewUri, 'http://gateway.test'),
    ).toBe(false);
  });
});
