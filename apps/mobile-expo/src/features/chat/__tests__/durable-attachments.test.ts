import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ files: new Map<string, { directory: boolean; modified: number }>(),
  records: new Map<string, string>(), deleted: [] as string[], serial: 0 }));
vi.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++state.serial).padStart(12, '0')}` }));
vi.mock('../../../storage/mmkv', () => ({ getStorageKeys: () => [...state.records.keys()],
  storage: { getString: (key: string) => state.records.get(key) } }));
vi.mock('expo-file-system', () => {
  class Entry {
    uri: string;
    constructor(...parts: Array<string | Entry>) { this.uri = parts.map(part => typeof part === 'string' ? part.replace(/\/$/, '') : part.uri).join('/'); }
    get name() { return this.uri.split('/').at(-1)!; }
    get exists() { return state.files.has(this.uri); }
    get modificationTime() { return state.files.get(this.uri)?.modified; }
  }
  class File extends Entry {
    write() { state.files.set(this.uri, { directory: false, modified: Date.now() }); }
    copy(target: File) { state.files.set(target.uri, { directory: false, modified: Date.now() }); }
  }
  class Directory extends Entry {
    create() { state.files.set(this.uri, { directory: true, modified: Date.now() }); }
    list() { return [...state.files.entries()].filter(([uri]) => uri.startsWith(this.uri + '/') && !uri.slice(this.uri.length + 1).includes('/'))
      .map(([uri, info]) => info.directory ? new Directory(uri) : new File(uri)); }
    delete() { state.deleted.push(this.uri); state.files.delete(this.uri); }
  }
  return { File, Directory, Paths: { document: 'file:///documents' } };
});
import { collectUnusedChatAttachments, persistComposerAttachments } from '../durable-attachments';

let now = 2 * 86_400_000;
it('stores only a durable file reference for inline and picker payloads', () => {
  const base = { id: 'inline', type: 'image' as const, name: 'large.png', mimeType: 'image/png', size: 3, content: 'YWJj' };
  for (const attachment of [base, { ...base, id: 'picker', localUri: 'file:///cache/image.png' }]) {
    const saved = persistComposerAttachments([attachment])[0]!;
    expect(saved.content).toBe('');
    expect(saved.localUri).toContain('/chat-drafts/');
    expect(persistComposerAttachments([saved])[0]).toEqual(saved);
  }
});
beforeEach(() => { state.files.clear(); state.records.clear(); state.deleted.length = 0; now += 86_400_000; });
function owned(name: string, ordinal: number, modified = 1): string {
  const root = `file:///documents/${name}`;
  const directory = `${root}/00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
  state.files.set(root, { directory: true, modified });
  state.files.set(directory, { directory: true, modified });
  state.files.set(`${directory}/payload`, { directory: false, modified });
  return `${directory}/payload`;
}

it('collects only old unreferenced app-owned payload directories', () => {
  const unused = owned('chat-outbox', 1);
  const pending = owned('chat-outbox', 2);
  owned('chat-drafts', 3, now);
  const composer = owned('chat-drafts', 4);
  state.records.set('outbox', JSON.stringify({ attachments: [{ localUri: pending }] }));
  state.records.set('composer', JSON.stringify({ attachments: [{ localUri: composer }] }));
  collectUnusedChatAttachments(now);
  expect(state.deleted).toEqual([unused.replace('/payload', '')]);
});

it('does not remove directories containing unexpected files', () => {
  const uri = owned('chat-drafts', 1);
  state.files.set(uri.replace('/payload', '/user-file'), { directory: false, modified: 1 });
  collectUnusedChatAttachments(now);
  expect(state.deleted).toEqual([]);
});

it('copies a picker file once and retains audio data and metadata', () => {
  const attachment = { id: 'a', type: 'audio' as const, name: 'voice.m4a', mimeType: 'audio/mp4', size: 10,
    content: '', localUri: 'file:///cache/voice.m4a', durationSeconds: 2 };
  const first = persistComposerAttachments([attachment])[0]!;
  expect(first.localUri).toContain('/chat-drafts/');
  expect(persistComposerAttachments([attachment])[0]).toEqual(first);
  expect(first.durationSeconds).toBe(2);
});
