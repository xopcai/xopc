import { describe, expect, it } from 'vitest';

import { parseWorkspaceFileLink, workspaceFileLinkRoute } from '../workspace-file-link';

describe('workspace file links', () => {
  it('recognizes both public xopc schemes and decodes the workspace path', () => {
    expect(parseWorkspaceFileLink('xopc://workspace/file?path=reports%2FMy+Report.html')).toEqual({
      path: 'reports/My Report.html',
    });
    expect(parseWorkspaceFileLink('xopc-mobile://workspace/file?path=ai-news-2026-09-10.html')).toEqual({
      path: 'ai-news-2026-09-10.html',
    });
  });

  it('routes chat links with their session workspace scope', () => {
    expect(workspaceFileLinkRoute(
      'xopc-mobile://workspace/file?path=output.html',
      'agent:main:webchat:default',
    )).toEqual({
      pathname: '/workspace/file',
      params: {
        path: 'output.html',
        sessionKey: 'agent:main:webchat:default',
      },
    });
  });

  it('does not capture unrelated, malformed, or pathless links', () => {
    expect(parseWorkspaceFileLink('https://example.com/file?path=report.html')).toBeNull();
    expect(parseWorkspaceFileLink('xopc://open?kind=file&id=one')).toBeNull();
    expect(parseWorkspaceFileLink('xopc://workspace/file')).toBeNull();
    expect(parseWorkspaceFileLink('not a URL')).toBeNull();
  });
});
