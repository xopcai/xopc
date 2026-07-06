import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../../storage/mmkv', () => ({
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => {
      memory.set(key, String(value));
    },
    delete: (key: string) => {
      memory.delete(key);
    },
  },
}));

vi.mock('../../../query/notes', () => ({
  captureNote: vi.fn(),
}));

vi.mock('../capture-note-media', () => ({
  captureNoteWithComposerAttachment: vi.fn(),
  captureNoteWithQueuedVoice: vi.fn(),
}));

import {
  flushPendingNotes,
  queueMediaCapture,
  queueNote,
} from '../notes-sync';
import { captureNoteWithComposerAttachment } from '../capture-note-media';

const mockedCaptureNoteWithComposerAttachment = vi.mocked(captureNoteWithComposerAttachment);

describe('notes-sync queueNote', () => {
  beforeEach(() => {
    memory.clear();
    vi.clearAllMocks();
  });

  it('preserves formatted markdown, kind, and source channel in the offline queue', () => {
    const operationId = queueNote('```\nconst value = 1;\n```', 'thought', 'clipboard');
    const raw = memory.get(`notes:capture:op:${operationId}`);

    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      payload: {
        type: 'text',
        text: '```\nconst value = 1;\n```',
        kind: 'thought',
        channel: 'clipboard',
      },
    });
  });

  it('flushes queued media captures through the attachment capture path', async () => {
    mockedCaptureNoteWithComposerAttachment.mockResolvedValue({ note: { id: 'note-1' } });
    const attachment = {
      id: 'att-local',
      type: 'image' as const,
      name: 'photo.png',
      mimeType: 'image/png',
      size: 4,
      content: 'ZGF0YQ==',
      localUri: 'file:///tmp/photo.png',
    };

    queueMediaCapture({ type: 'attachment', attachment, text: 'photo note' });

    await expect(flushPendingNotes()).resolves.toBe(1);
    expect(mockedCaptureNoteWithComposerAttachment).toHaveBeenCalledWith(attachment, 'photo note');
  });
});
