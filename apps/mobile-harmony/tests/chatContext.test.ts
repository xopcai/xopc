import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined }); return { request: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mock.request } }));
import { XopcChatContextViewModel } from '../entry/src/main/ets/viewmodel/chatContextViewModel.ets';
const summary = (id: string) => ({ summary: { conversationId: id, work: {}, sources: [], sourcesHasMore: false, unavailableSections: [] } });
describe('chat context', () => {
  beforeEach(() => vi.resetAllMocks());
  it('does not apply another conversation summary', async () => {
    mock.request.mockResolvedValue(JSON.stringify(summary('other'))); const model = new XopcChatContextViewModel(); await model.load('one');
    expect(model.summary).toBeUndefined(); expect(model.error).toBe('INVALID_CONTEXT');
  });
  it('does not allow directory changes for a locked session', async () => {
    const model = new XopcChatContextViewModel(); model.config = { workingDirectoryLocked: true };
    model.directories = { currentPath: '/project', entries: [] }; expect(await model.setDirectory()).toBe(false); expect(mock.request).not.toHaveBeenCalled();
  });
  it('uses server note timestamps as expected reference versions', async () => {
    mock.request.mockResolvedValue(JSON.stringify({ items: [{ id: 'one', title: 'Note', updatedAt: 123, status: 'active' }, { id: 'trash', updatedAt: 456, status: 'trashed' }] }));
    const model = new XopcChatContextViewModel(); await model.searchReferences('note', 'hello');
    expect(model.references).toHaveLength(1); expect(model.references[0].version).toBe('123'); expect(mock.request.mock.calls[0][0]).toContain('search=hello');
  });
  it('reads file references from the selected conversation space, including scoped search', async () => {
    mock.request.mockResolvedValueOnce(JSON.stringify(summary('one'))).mockResolvedValueOnce(JSON.stringify({ payload: {} }))
      .mockResolvedValueOnce(JSON.stringify({ space: { id: 'space-one' } })).mockResolvedValueOnce(JSON.stringify({ items: [{ id: 'f', name: 'a.txt', relativePath: 'docs/a.txt', revision: 'r1', kind: 'file', mimeType: 'text/plain', size: 8 }] }));
    const model = new XopcChatContextViewModel(); await model.load('one'); await model.searchReferences('file', 'a');
    expect(mock.request.mock.calls[2][0]).toBe('/api/files/contexts/session/one');
    expect(mock.request.mock.calls[3][0]).toContain('spaceId=space-one'); expect(model.references[0].relativePath).toBe('docs/a.txt');
  });
});
