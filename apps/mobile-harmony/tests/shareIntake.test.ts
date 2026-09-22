import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (): void => {}, Trace: (): void => {} });
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));

import { decodeShareHandoff, encodeShareHandoff, incomingShare, XopcShareIntake } from '../entry/src/main/ets/service/shareIntake.ets';

describe('Harmony inbound share intake', () => {
  beforeEach(() => vi.resetAllMocks());

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
  });

  it('saves only after confirmation and hands a chat prompt to one matching conversation', async () => {
    const intake = new XopcShareIntake();
    const value = incomingShare('', ['A useful shared paragraph'])!;
    intake.receive(value);
    mocks.request.mockResolvedValueOnce(JSON.stringify({ note: { id: 'note-1' } }));
    await expect(intake.save()).resolves.toBe('note-1');
    expect(mocks.request).toHaveBeenCalledWith('/api/notes/quick-capture', 'POST', JSON.stringify({
      text: value.content, channel: 'share', platform: 'harmonyos'
    }));

    intake.targetChat('conversation-1', value.chatPrompt);
    expect(intake.consumeChat('conversation-2')).toBe('');
    expect(intake.consumeChat('conversation-1')).toBe(value.chatPrompt);
    expect(intake.consumeChat('conversation-1')).toBe('');
  });
});
