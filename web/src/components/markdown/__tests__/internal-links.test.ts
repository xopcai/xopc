// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  findWorkspaceRelativeFileMentions,
  linkWorkspaceFileMentions,
  openHttpLinksInNewTab,
  parseWorkspaceFileLinkTarget,
  rewriteXopcSettingsLinksInMarkdown,
  xopcSettingsUrlToRoute,
  xopcWorkspaceFileUrlToHref,
} from '../internal-links';

describe('markdown internal links', () => {
  it('maps xopc settings deep links to hash-router paths', () => {
    expect(xopcSettingsUrlToRoute('xopc://settings/agent-browser?tab=extension')).toBe(
      '/settings/agent-browser?tab=extension',
    );
    expect(xopcSettingsUrlToRoute('xopc://gateway/mobile-connect?ps=secret')).toBeNull();

    expect(
      rewriteXopcSettingsLinksInMarkdown('Open [settings](xopc://settings/agent-browser?tab=extension).'),
    ).toBe('Open [settings](/settings/agent-browser?tab=extension).');
  });

  it('maps xopc workspace file deep links to internal hrefs', () => {
    expect(xopcWorkspaceFileUrlToHref('xopc://workspace/file?path=src%2Fapp.ts&line=3')).toBe(
      '/xopc/workspace/file?path=src%2Fapp.ts&line=3',
    );
    expect(
      rewriteXopcSettingsLinksInMarkdown('Open [file](xopc://workspace/file?path=src%2Fapp.ts&line=3).'),
    ).toBe('Open [file](/xopc/workspace/file?path=src%2Fapp.ts&line=3).');
    expect(parseWorkspaceFileLinkTarget('/xopc/workspace/file?path=src%2Fapp.ts&line=3')).toEqual({
      path: 'src/app.ts',
      line: 3,
      kind: 'workspace-relative',
    });
  });

  it('parses workspace-relative file targets with optional line numbers', () => {
    expect(parseWorkspaceFileLinkTarget('src/app.ts')).toEqual({ path: 'src/app.ts', kind: 'workspace-relative' });
    expect(parseWorkspaceFileLinkTarget('src/app.ts:42')).toEqual({
      path: 'src/app.ts',
      line: 42,
      kind: 'workspace-relative',
    });
    expect(parseWorkspaceFileLinkTarget('src/app.ts#L7')).toEqual({
      path: 'src/app.ts',
      line: 7,
      kind: 'workspace-relative',
    });
    expect(parseWorkspaceFileLinkTarget('/Users/me/app.ts')).toEqual({
      path: '/Users/me/app.ts',
      kind: 'absolute',
    });
    expect(parseWorkspaceFileLinkTarget('https://example.com/app.ts')).toBeNull();
  });

  it('finds path-shaped workspace file mentions', () => {
    expect(findWorkspaceRelativeFileMentions('See src/app.ts and media/result.png:12')).toEqual([
      { path: 'src/app.ts', kind: 'workspace-relative' },
      { path: 'media/result.png', line: 12, kind: 'workspace-relative' },
    ]);
  });

  it('finds absolute file mentions', () => {
    expect(findWorkspaceRelativeFileMentions('Open /Users/me/project/src/app.ts:9')).toEqual([
      { path: '/Users/me/project/src/app.ts', line: 9, kind: 'absolute' },
    ]);
  });

  it('links workspace file mentions outside code and existing anchors', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p>Open src/app.ts and <code>src/skip.ts</code> and <a href="docs/existing.md">docs/existing.md</a>.</p>';

    linkWorkspaceFileMentions(root);

    const links = [...root.querySelectorAll<HTMLAnchorElement>('a.markdown-file-link')];
    expect(links).toHaveLength(1);
    expect(links[0]?.dataset.xopcFilePath).toBe('src/app.ts');
    expect(links[0]?.dataset.xopcFileKind).toBe('workspace-relative');
    expect(root.querySelector('code')?.innerHTML).toBe('src/skip.ts');
    expect(root.querySelector('a[href="docs/existing.md"]')?.textContent).toBe('docs/existing.md');
  });

  it('opens HTTP(S) links separately without changing deep links', () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<a href="http://127.0.0.1:18790/site/example/">Published site</a>',
      '<a href="https://example.com/docs">Docs</a>',
      '<a href="xopc://settings/gateway">Settings</a>',
    ].join('');

    openHttpLinksInNewTab(root);

    const [site, docs, settings] = [...root.querySelectorAll<HTMLAnchorElement>('a')];
    expect(site?.target).toBe('_blank');
    expect(site?.rel).toContain('noopener');
    expect(site?.rel).toContain('noreferrer');
    expect(docs?.target).toBe('_blank');
    expect(settings?.target).toBe('');
  });
});
