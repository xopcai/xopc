// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  findWorkspaceRelativeFileMentions,
  linkWorkspaceFileMentions,
  parseWorkspaceFileLinkTarget,
  rewriteWorkspaceFileLinksInMarkdown,
  xopcWorkspaceFileUrlToHref,
} from '../internal-links';

describe('markdown internal links', () => {
  it('maps xopc workspace file deep links to internal hrefs', () => {
    expect(xopcWorkspaceFileUrlToHref('xopc://workspace/file?path=src%2Fapp.ts&line=3')).toBe(
      '/xopc/workspace/file?path=src%2Fapp.ts&line=3',
    );
    expect(
      rewriteWorkspaceFileLinksInMarkdown('Open [file](xopc://workspace/file?path=src%2Fapp.ts&line=3).'),
    ).toBe('Open [file](/xopc/workspace/file?path=src%2Fapp.ts&line=3).');
    expect(
      rewriteWorkspaceFileLinksInMarkdown('[下载](file:///Users/me/My%20Report.xlsx)'),
    ).toBe('[下载](/xopc/workspace/file?path=%2FUsers%2Fme%2FMy+Report.xlsx)');
    expect(
      rewriteWorkspaceFileLinksInMarkdown('[下载](<./报表/销售 明细.xlsx>)'),
    ).toBe('[下载](/xopc/workspace/file?path=%E6%8A%A5%E8%A1%A8%2F%E9%94%80%E5%94%AE+%E6%98%8E%E7%BB%86.xlsx)');
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
    expect(parseWorkspaceFileLinkTarget('./报表/%E9%94%80%E5%94%AE%20%E6%98%8E%E7%BB%86.xlsx')).toEqual({
      path: '报表/销售 明细.xlsx',
      kind: 'workspace-relative',
    });
    expect(parseWorkspaceFileLinkTarget('file:///Users/me/My%20Report.xlsx')).toEqual({
      path: '/Users/me/My Report.xlsx',
      kind: 'absolute',
    });
    expect(parseWorkspaceFileLinkTarget('file:///C:/Users/me/My%20Report.xlsx')).toEqual({
      path: 'C:/Users/me/My Report.xlsx',
      kind: 'absolute',
    });
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

  it('finds bare and non-ASCII workspace file mentions', () => {
    expect(findWorkspaceRelativeFileMentions('已完成：销售明细查询-按客户分类汇总-2026-09-02.xlsx')).toEqual([
      { path: '销售明细查询-按客户分类汇总-2026-09-02.xlsx', kind: 'workspace-relative' },
    ]);
    expect(findWorkspaceRelativeFileMentions('查看 报表/华东汇总.xlsx 和 export.csv')).toEqual([
      { path: '报表/华东汇总.xlsx', kind: 'workspace-relative' },
      { path: 'export.csv', kind: 'workspace-relative' },
    ]);
  });

  it('links workspace file mentions outside code and existing anchors', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p>Open src/app.ts and 结果.xlsx and <code>src/skip.ts</code> and <a href="docs/existing.md">docs/existing.md</a>.</p>';

    linkWorkspaceFileMentions(root);

    const links = [...root.querySelectorAll<HTMLAnchorElement>('a.markdown-file-link')];
    expect(links).toHaveLength(2);
    expect(links[0]?.dataset.xopcFilePath).toBe('src/app.ts');
    expect(links[0]?.dataset.xopcFileKind).toBe('workspace-relative');
    expect(links[1]?.dataset.xopcFilePath).toBe('结果.xlsx');
    expect(root.querySelector('code')?.innerHTML).toBe('src/skip.ts');
    expect(root.querySelector('a[href="docs/existing.md"]')?.textContent).toBe('docs/existing.md');
  });

});
