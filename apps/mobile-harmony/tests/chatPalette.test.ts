import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mock.request, currentProfile: () => ({ gatewayId: 'g' }) } }));
import { composerRange, workspaceMention } from '../entry/src/main/ets/common/composerTokens.ets';
import { XopcChatPaletteViewModel } from '../entry/src/main/ets/viewmodel/chatPaletteViewModel.ets';
describe('composer token palette', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());
  it('gives mentions precedence over slashes in paths, without reopening applied tokens or email addresses', () => {
    expect(composerRange('@src/', 5)).toMatchObject({ kind: 'mention', query: 'src/' });
    expect(composerRange('me@example', 10)).toBeUndefined();
    expect(composerRange('/skill:review', 13)).toBeUndefined();
    expect(composerRange('@file:readme', 12)).toBeUndefined();
    expect(composerRange('hello /review', 13)).toMatchObject({ kind: 'slash', start: 6 });
    expect(workspaceMention('my notes/a.md')).toBe('@file:"my notes/a.md" ');
  });
  it('inserts canonical skills and only offers commands at the start of input', async () => {
    mock.request.mockImplementation(async (path) => JSON.stringify({ payload: path === '/api/commands'
      ? { commands: [{ id: 'help', name: 'help', description: 'Help', aliases: [], acceptsArgs: false }] }
      : { catalog: [{ name: 'review', description: 'Review', enabled: true, localizations: { 'zh-CN': { displayName: '代码审查', description: '审查修改' } } }, { name: 'disabled', enabled: false }] } }));
    const model = new XopcChatPaletteViewModel(); model.update('/', 1, 'one', 'zh-CN'); await vi.advanceTimersByTimeAsync(150);
    expect(model.items.map(item => item.token)).toEqual(['/skill:review ', '/help\n']);
    expect(model.items[0].name).toBe('代码审查');
    model.update('check /', 7, 'one', 'zh-CN'); await vi.advanceTimersByTimeAsync(150);
    expect(model.items.map(item => item.kind)).toEqual(['skill']); expect(mock.request).toHaveBeenCalledTimes(2); model.dispose();
  });
  it('keeps mention searches conversation-scoped and preserves note versions', async () => {
    mock.request.mockImplementation(async (path) => path.startsWith('/api/notes') ? JSON.stringify({ items: [{ id: 'n', title: 'Note', updatedAt: 42, status: 'active' }] })
      : path.includes('/contexts/session/') ? JSON.stringify({ space: { id: 'space-one' } })
      : JSON.stringify({ items: [{ id: 'f', name: 'file.md', relativePath: 'dir/file.md', kind: 'file', revision: 'r' }] }));
    const model = new XopcChatPaletteViewModel(); model.update('@dir/', 5, 'one', 'en'); await vi.advanceTimersByTimeAsync(150);
    expect(mock.request).toHaveBeenCalledWith('/api/files/contexts/session/one');
    expect(mock.request).toHaveBeenCalledWith('/api/files/spaces/space-one/children?path=dir');
    expect(model.items[0]).toMatchObject({ kind: 'note', sourceId: 'n', version: '42' });
    expect(model.items[1].token).toBe('@file:dir/file.md '); model.dispose();
  });
  it('cancels pending search when the drawer or another page opens', async () => {
    const model = new XopcChatPaletteViewModel(); model.update('/', 1, 'one', 'en'); model.close(); await vi.advanceTimersByTimeAsync(1000);
    expect(mock.request).not.toHaveBeenCalled(); expect(model.range).toBeUndefined(); model.dispose();
  });
});
