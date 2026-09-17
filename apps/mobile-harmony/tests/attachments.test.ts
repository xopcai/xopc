import { describe, expect, it } from 'vitest';
import { attachmentMime, chatInputIdentity, validateAttachmentSize, MAX_ATTACHMENT_BYTES } from '../entry/src/main/ets/common/attachments.ets';
import { validateWebchatAttachments } from '../../../src/gateway/chat-limits.js';
import { historyRows } from '../entry/src/main/ets/common/chatProtocol.ets';

const file = { type: 'document', name: 'hello.txt', mimeType: 'text/plain', size: 5, data: 'aGVsbG8=' };
describe('native chat attachment contract', () => {
  it('maps image/document MIME types and uses the Gateway base64 wire contract', () => {
    expect(attachmentMime('Photo.JPG')).toBe('image/jpeg');
    expect(attachmentMime('notes.md')).toBe('text/markdown');
    expect(attachmentMime('unknown.bin')).toBe('application/octet-stream');
    expect(validateWebchatAttachments([file])).toBeNull();
  });
  it('rejects empty/oversized files and excessive attachment counts or total bytes', () => {
    expect(() => validateAttachmentSize(0, [])).toThrow('EMPTY_ATTACHMENT');
    expect(() => validateAttachmentSize(MAX_ATTACHMENT_BYTES + 1, [])).toThrow('ATTACHMENT_LIMIT_10_MB');
    expect(() => validateAttachmentSize(1, Array(10).fill(file))).toThrow('ATTACHMENT_LIMIT_10');
    expect(() => validateAttachmentSize(1, [{ ...file, size: 20 * 1024 * 1024 }])).toThrow('ATTACHMENT_TOTAL_LIMIT_20_MB');
    expect(() => validateAttachmentSize(MAX_ATTACHMENT_BYTES, [])).not.toThrow();
  });
  it('keeps retry identity stable only while text and attachment content are unchanged', () => {
    expect(chatInputIdentity('', [file])).toBe(chatInputIdentity('', [{ ...file }]));
    expect(chatInputIdentity('same text', [file])).not.toBe(chatInputIdentity('same text', [{ ...file, data: 'Ynl0ZXM=' }]));
    expect(chatInputIdentity('', [file])).not.toBe(chatInputIdentity('', []));
  });
  it('keeps attachment-only messages visible after loading persisted history', () => {
    const rows = historyRows({ session: { key: 'one', messages: [{ id: 'message-1', role: 'user', content: '',
      media: [{ id: 'media-1', name: 'hello.txt', type: 'document', mimeType: 'text/plain', size: 5, uri: 'media://test' }] }] },
      pagination: { hasMore: false } });
    expect(rows).toEqual([{ id: 'message-1', role: 'user', text: '\n[hello.txt]' }]);
  });
});
