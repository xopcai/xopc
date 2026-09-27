import { describe, expect, it } from 'vitest';
import { internalMessageLink } from '../entry/src/main/ets/common/messageLink';
import { markdownSpans } from '../entry/src/main/ets/common/markdown';

describe('message link routing', () => {
  it('renders the screenshot link as a label and decodes its workspace path once', () => {
    const href = 'xopc://workspace/file?path=' + encodeURIComponent('工作区档案目录.html');
    expect(markdownSpans(`[打开工作区档案目录](${href})`)).toMatchObject([
      { kind: 'link', text: '打开工作区档案目录', href },
    ]);
    expect(internalMessageLink(href)).toMatchObject({ kind: 'file', path: '工作区档案目录.html' });
    expect(internalMessageLink('/xopc/workspace/file?path=My+Report.html')).toMatchObject({ path: 'My Report.html' });
    expect(internalMessageLink('xopc://workspace/file?path=100%2525.html')).toMatchObject({ path: '100%25.html' });
  });
  it.each([['session', 'chat'], ['note', 'notes'], ['task', 'tasks'], ['project', 'projects'],
    ['automation', 'automations'], ['file', 'files'], ['workflow_run', 'workflows']])('routes %s', (kind, page) => {
    expect(internalMessageLink(`xopc://open?kind=${kind}&id=a%2Fb`)).toMatchObject({ kind: 'route', page, itemId: 'a/b' });
  });
  it('supports legacy session keys and web route links', () => {
    expect(internalMessageLink('xopc://open?kind=session&amp;key=chat-1')).toMatchObject({ page: 'chat', itemId: 'chat-1' });
    expect(internalMessageLink('#/notes/note-1')).toMatchObject({ page: 'notes', itemId: 'note-1' });
    expect(internalMessageLink('xopc://settings/appearance')).toMatchObject({ page: 'settings', itemId: 'appearance' });
  });
  it.each(['xopc://open?kind=note', 'xopc://open?kind=constructor&id=x', 'xopc://workspace/file?path=../secret',
    'xopc://workspace/file?path=%00x', 'xopc://workspace/file?path=%ZZ', 'javascript:alert(1)', '//evil.test', '/api/private'])('rejects %s', href => {
    expect(internalMessageLink(href)).toBeUndefined();
    expect(markdownSpans(`[invalid](${href})`).some(span => span.href)).toBe(false);
  });
  it('preserves external links and inline code', () => {
    expect(markdownSpans('[网页](https://example.com/a_(b))')[0]).toMatchObject({ kind: 'link', text: '网页' });
    expect(markdownSpans('`[笔记](xopc://open?kind=note&id=a)`')[0].kind).toBe('code');
  });
});
