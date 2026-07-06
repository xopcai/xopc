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
  const apiUrl = (path: string) => `http://gateway.test${path}`;

  it('prefers workspace raw URL for relative assets', () => {
    expect(
      buildHtmlWebViewSource({
        workspaceRelativePath: 'docs/guide.html',
        htmlContent: '<html></html>',
        sessionKey: 's:1',
        apiUrl,
        token: 'tok',
        gatewayBaseUrl: 'http://gateway.test',
      }),
    ).toEqual({
      uri: 'http://gateway.test/api/workspace/editor/raw?path=docs%2Fguide.html&sessionKey=s%3A1',
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('uses agent scope when building workspace raw URL without a session', () => {
    expect(
      buildHtmlWebViewSource({
        workspaceRelativePath: 'docs/guide.html',
        agentId: 'writer',
        apiUrl,
        token: '',
        gatewayBaseUrl: 'http://gateway.test',
      }),
    ).toEqual({
      uri: 'http://gateway.test/api/workspace/editor/raw?path=docs%2Fguide.html&agentId=writer',
      headers: undefined,
    });
  });

  it('falls back to inline html when no workspace path', () => {
    expect(
      buildHtmlWebViewSource({
        htmlContent: '<html><body>Hi</body></html>',
        apiUrl,
        token: '',
        gatewayBaseUrl: 'http://gateway.test/',
      }),
    ).toEqual({
      html: '<html><body>Hi</body></html>',
      baseUrl: 'http://gateway.test/',
    });
  });
});

describe('shouldAllowHtmlWebViewNavigation', () => {
  const previewUri = 'http://gateway.test/api/workspace/editor/raw?path=guide.html';

  it('allows preview and gateway URLs', () => {
    expect(shouldAllowHtmlWebViewNavigation(previewUri, previewUri, 'http://gateway.test')).toBe(true);
    expect(
      shouldAllowHtmlWebViewNavigation(
        'http://gateway.test/api/workspace/editor/raw?path=styles.css',
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
