import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../../storage/mmkv', () => ({
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string) => {
      memory.set(key, String(value));
    },
    delete: (key: string) => {
      memory.delete(key);
    },
  },
}));

import {
  clearNoteChatPrefill,
  consumeNoteChatPrefill,
  readNoteChatPrefill,
  writeNoteChatPrefill,
} from '../note-chat-prefill-storage';

const SESSION_KEY = 'agent:main:webchat:default:direct:test-chat';

describe('note-chat-prefill-storage', () => {
  beforeEach(() => {
    memory.clear();
    clearNoteChatPrefill(SESSION_KEY);
  });

  it('writes and consumes a one-shot prefill snapshot', () => {
    writeNoteChatPrefill(SESSION_KEY, {
      text: 'hello note',
      attachments: [{
        id: 'a1',
        type: 'image',
        name: 'pic.png',
        mimeType: 'image/png',
        size: 3,
        content: 'YWJj',
      }],
    });

    const first = consumeNoteChatPrefill(SESSION_KEY);
    expect(first?.text).toBe('hello note');
    expect(first?.attachments).toHaveLength(1);

    expect(readNoteChatPrefill(SESSION_KEY)).toBeNull();
    expect(consumeNoteChatPrefill(SESSION_KEY)).toBeNull();
  });

  it('persists workspaceRelativePath on attachments', () => {
    writeNoteChatPrefill(SESSION_KEY, {
      text: '',
      attachments: [{
        id: 'a2',
        type: 'document',
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 10,
        content: '',
        workspaceRelativePath: 'inbound/n/doc.pdf',
      }],
    });

    const snap = consumeNoteChatPrefill(SESSION_KEY);
    expect(snap?.attachments[0].workspaceRelativePath).toBe('inbound/n/doc.pdf');
  });
});
