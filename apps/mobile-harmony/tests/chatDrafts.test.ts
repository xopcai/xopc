import { beforeEach, describe, expect, it, vi } from 'vitest';
const records = vi.hoisted(() => new Map<string, string>());
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({ XopcSecureStore: class {
  async read(key: string) { return records.get(key); }
  async write(key: string, value: string) { records.set(key, value); }
  async remove(key: string) { records.delete(key); }
} }));
import { XopcChatDrafts } from '../entry/src/main/ets/service/chatDrafts.ets';
describe('conversation drafts', () => {
  beforeEach(() => records.clear());
  it('isolates gateways and conversations, including reference versions', async () => {
    const store = new XopcChatDrafts(); const value = { text: 'unfinished', refs: [{ kind: 'note', sourceId: 'n', expectedVersion: '4', title: 'Note' }], files: [] };
    await store.save('gateway-a:one', value); expect(await store.read('gateway-a:one')).toEqual(value);
    expect(await store.read('gateway-a:two')).toBeUndefined(); expect(await store.read('gateway-b:one')).toBeUndefined();
  });
  it('persists workspace references, never local binary attachments or transient URIs', async () => {
    const store = new XopcChatDrafts(); const file = { name: 'readme.md', mimeType: 'text/markdown', size: 10, type: 'document', data: '', workspaceRelativePath: 'readme.md' };
    await store.save('g:c', { text: '', refs: [], files: [file, { ...file, data: 'private base64' }, { ...file, uri: 'temporary://file' }] });
    expect((await store.read('g:c'))?.files).toEqual([file]);
  });
  it('bounds drafts and removes accepted or explicitly discarded empty drafts', async () => {
    const store = new XopcChatDrafts(); await store.save('g:c', { text: 'x'.repeat(25000), refs: [], files: [] });
    expect((await store.read('g:c'))?.text).toHaveLength(20000);
    await store.save('g:c', { text: '', refs: [], files: [] }); expect(await store.read('g:c')).toBeUndefined();
  });
  it('rejects malformed persisted snapshots without breaking the composer', async () => {
    const store = new XopcChatDrafts(); records.set('chat-draft:g:c', '{'); expect(await store.read('g:c')).toBeUndefined();
    records.set('chat-draft:g:c', JSON.stringify({ text: '', refs: [null], files: [null] })); expect(await store.read('g:c')).toEqual({ text: '', refs: [], files: [] });
  });
});
