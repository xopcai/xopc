import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), records: new Map<string, string>(), readAttachment: vi.fn(), unlink: vi.fn(), listFile: vi.fn(), readText: vi.fn(), failDraft: false }));
vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (): void => {}, Trace: (): void => {} });
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request, currentProfile: () => ({ gatewayId: 'gateway', deviceId: 'device' }), connectionRevision: () => 1, assertConnection: () => {} } }));
vi.mock('../entry/src/main/ets/service/localSessionStore.ets', () => ({ localSessionStore: {
  readComposer: async (scope: string) => mocks.records.get(scope),
  writeComposer: async (scope: string, payload: string) => { if (scope !== '@external-intake' && mocks.failDraft) throw new Error('disk full'); mocks.records.set(scope, payload); },
  read: async () => ({ conversationId: 'conversation-1' }),
} }));
vi.mock('../entry/src/main/ets/service/chatAttachmentPicker.ets', () => ({ readChatAttachment: mocks.readAttachment }));
vi.mock('@kit.CoreFileKit', () => ({ fileIo: { unlink: mocks.unlink, listFile: mocks.listFile, readText: mocks.readText } }));
vi.mock('@kit.ArkTS', () => ({ util: { generateRandomUUID: (): string => 'mutation-1' } }));
vi.mock('../entry/src/main/ets/service/noteMedia.ets', () => ({ XopcNoteMediaService: class {} }));
vi.mock('../entry/src/main/ets/repository/noteRepository.ets', () => ({ XopcNoteRepository: class {} }));

import { decodeShareHandoff, encodeShareHandoff, incomingShare, XopcShareIntake } from '../entry/src/main/ets/service/shareIntake.ets';

describe('Harmony inbound share intake', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.records.clear(); mocks.failDraft = false; mocks.unlink.mockResolvedValue(undefined); mocks.listFile.mockResolvedValue([]); });

  it('combines a title and shared link and prepares the same link-specific chat prompt', () => {
    const value = incomingShare('Article', ['https://xopc.ai/post']);
    expect(value).toMatchObject({ title: 'Article', kind: 'url', content: 'Article\nhttps://xopc.ai/post' });
    expect(value?.chatPrompt).toContain('风险和下一步建议');
  });

  it('masks sensitive preview without changing the content sent by an explicit action', () => {
    const value = incomingShare('', ['api_key="secret-value-123"\nuser@example.com']);
    expect(value?.sensitive).toBe(true);
    expect(value?.preview).not.toContain('secret-value-123');
    expect(value?.preview).not.toContain('user@example.com');
    expect(value?.content).toContain('secret-value-123');
  });

  it('rejects unusable snippets', () => {
    expect(incomingShare('', ['  '])).toBeUndefined();
    expect(incomingShare('', ['x'])).toBeUndefined();
    expect(incomingShare('', ['验证码 123456，请勿泄露'])).toBeUndefined();
  });

  it('hands shared content from the extension process to the main process', () => {
    const payload = encodeShareHandoff('Article', ['https://xopc.ai/post']);
    expect(decodeShareHandoff(payload)).toMatchObject({
      title: 'Article', kind: 'url', content: 'Article\nhttps://xopc.ai/post'
    });
    expect(decodeShareHandoff('{')).toBeUndefined();
    expect(decodeShareHandoff(JSON.stringify({ title: 'Article', values: [42] }))).toBeUndefined();
    expect(decodeShareHandoff(JSON.stringify({ title: '', values: [], attachments: [{
      path: '/tmp/private', name: 'private', mimeType: 'text/plain', size: 10,
    }] }))).toBeUndefined();
  });

  it('saves only after confirmation and hands a chat prompt to one matching conversation', async () => {
    const intake = new XopcShareIntake();
    const value = incomingShare('', ['A useful shared paragraph'])!;
    intake.receive(value);
    mocks.request.mockResolvedValueOnce(JSON.stringify({ note: { id: 'note-1' } }));
    await expect(intake.save()).resolves.toBe('note-1');
    expect(mocks.request).toHaveBeenCalledWith('/api/notes/quick-capture', 'POST', JSON.stringify({
      text: value.content, channel: 'share', platform: 'harmonyos'
    }), 'mutation-1');

    intake.targetChat('conversation-1', value.chatPrompt);
    expect(intake.consumeChat('conversation-2')).toBe('');
    expect(intake.consumeChat('conversation-1')).toBe(value.chatPrompt);
    expect(intake.consumeChat('conversation-1')).toBe('');
  });

  it('reuses the capture mutation id after a retryable save failure', async () => {
    const intake = new XopcShareIntake();
    intake.receive(incomingShare('', ['Retry this shared note'])!);
    mocks.request.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(JSON.stringify({ note: { id: 'note-2' } }));
    await expect(intake.save()).rejects.toThrow('offline');
    await expect(intake.save()).resolves.toBe('note-2');
    expect(mocks.request.mock.calls[0][3]).toBe('mutation-1');
    expect(mocks.request.mock.calls[1][3]).toBe('mutation-1');
  });
  it('keeps consecutive batches and persists real file bytes with the existing draft and references', async () => {
    const intake = new XopcShareIntake(); await intake.initialize('/files');
    const scope = JSON.stringify(['gateway', 'device', 'conversation-1']);
    const existing = { type: 'document', name: 'existing.txt', mimeType: 'text/plain', size: 1, data: 'YQ==' };
    const ref = { kind: 'note', sourceId: 'note', expectedVersion: '1', title: 'Reference' };
    mocks.records.set(scope, JSON.stringify({ text: 'keep my question', files: [existing], refs: [ref] }));
    const shared = incomingShare('', [], [{ path: '/files/share-12345678-1234-4234-8234-123456789abc-photo.png', name: 'photo.png', mimeType: 'image/png', size: 3 }])!;
    shared.intakeId = 'first';
    const next = incomingShare('', ['second share'])!; next.intakeId = 'second';
    intake.receive(shared); intake.receive(next);
    expect(intake.queuedCount).toBe(2); expect(intake.pending?.intakeId).toBe('first');
    expect(mocks.unlink).not.toHaveBeenCalled();
    mocks.readAttachment.mockResolvedValue({ type: 'image', name: 'temporary-name.png', mimeType: 'image/png', size: 3, data: 'AAH/' });
    await intake.addToChat('conversation-1');
    const saved = JSON.parse(mocks.records.get(scope)!);
    expect(saved.text).toBe('keep my question'); expect(saved.refs).toEqual([ref]);
    expect(saved.files).toEqual([existing, expect.objectContaining({ name: 'photo.png', data: 'AAH/' })]);
    expect(saved.intakeReceipts).toEqual(['first']); expect(intake.pending?.intakeId).toBe('second');
    expect(mocks.request).not.toHaveBeenCalled();
    intake.dismiss(); intake.receive(shared);
    await intake.addToChat('conversation-1');
    expect(mocks.readAttachment).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.records.get(scope)!).files).toHaveLength(2);
  });

  it('keeps a failed delivery available and only clears source files after draft persistence succeeds', async () => {
    const intake = new XopcShareIntake(); await intake.initialize('/files');
    const shared = incomingShare('', ['raw shared text'])!; shared.intakeId = 'retry';
    intake.receive(shared); mocks.failDraft = true;
    await expect(intake.addToChat('conversation-1')).rejects.toThrow('disk full');
    expect(intake.pending?.intakeId).toBe('retry'); expect(mocks.unlink).not.toHaveBeenCalled();
    mocks.failDraft = false; await intake.addToChat('conversation-1');
    expect(intake.pending).toBeUndefined();
    const saved = JSON.parse(mocks.records.get(JSON.stringify(['gateway', 'device', 'conversation-1']))!);
    expect(saved.text).toBe('raw shared text');
    expect(saved.text).not.toContain('请围绕');
  });

  it('does not expire an assigned batch when its original extension manifest is older than a day', async () => {
    const id = '12345678-1234-4234-8234-123456789abc';
    const old = Date.now() - 2 * 86400000;
    const incoming = incomingShare('', ['retained share'])!;
    Object.assign(incoming, { intakeId: id, createdAt: old,
      targetConversationId: 'conversation-1', targetScope: JSON.stringify(['gateway', 'device', 'conversation-1']) });
    mocks.records.set('@external-intake', JSON.stringify([incoming]));
    mocks.listFile.mockResolvedValue(['intake-' + id + '.json']);
    mocks.readText.mockResolvedValue(JSON.stringify({ intakeId: id, createdAt: old, title: '', values: ['retained share'] }));
    const intake = new XopcShareIntake(); await intake.initialize('/files');
    expect(intake.pending?.intakeId).toBe(id);
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

});
