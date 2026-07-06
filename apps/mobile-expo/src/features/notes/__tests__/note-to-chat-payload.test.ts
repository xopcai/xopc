import { afterEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../../query/notes', () => ({
  uploadNoteMedia: vi.fn(),
}));

import { composerAttachmentsToWire } from '../../chat/composer.types';
import { MAX_CHAT_ATTACHMENTS } from '../../chat/chat-limits';
import {
  buildNoteChatContextText,
  collectNoteAttachmentsForChat,
  extractVoiceTranscripts,
} from '../note-to-chat-payload';
import {
  createLocalNoteAttachment,
  resetLocalNoteAttachmentsForTests,
} from '../notes-local-attachments';
import type { NoteEditorAttachment } from '../note-to-chat-payload';
import type { NoteAttachment } from '../../../query/notes';

const labels = {
  imagePlaceholder: (alt: string) => `[Image: ${alt}]`,
  voiceTranscript: (text: string) => `[Voice transcript: ${text}]`,
};

afterEach(() => {
  resetLocalNoteAttachmentsForTests('note-1');
  memory.clear();
});

describe('buildNoteChatContextText', () => {
  it('keeps markdown structure without embedding image attachment ids as raw data', () => {
    const text = buildNoteChatContextText('## Title\n\n![screenshot](att-img)\n\nBody text', labels);
    expect(text).toContain('## Title');
    expect(text).toContain('[Image: screenshot]');
    expect(text).toContain('Body text');
  });

  it('appends voice transcripts after body text', () => {
    const text = buildNoteChatContextText('Notes', labels, {
      voiceTranscripts: ['Buy milk'],
    });
    expect(text).toBe('Notes\n\n[Voice transcript: Buy milk]');
  });
});

describe('extractVoiceTranscripts', () => {
  it('returns trimmed transcripts from audio attachments', () => {
    const attachments: NoteAttachment[] = [
      {
        id: 'a1',
        type: 'audio',
        mimeType: 'audio/m4a',
        fileName: 'voice.m4a',
        size: 1,
        relativePath: 'inbound/n/voice.m4a',
        transcript: '  hello  ',
      },
    ];
    expect(extractVoiceTranscripts(attachments)).toEqual(['hello']);
  });
});

describe('collectNoteAttachmentsForChat', () => {
  it('collects markdown image refs via synced attachments', async () => {
    const synced: NoteAttachment[] = [{
      id: 'att-img',
      type: 'image',
      mimeType: 'image/png',
      fileName: 'pic.png',
      size: 3,
      relativePath: 'inbound/n/pic.png',
    }];
    const result = await collectNoteAttachmentsForChat('note-1', '![pic](att-img)', [], synced);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].type).toBe('image');
    expect(result.attachments[0].uri).toBe('xopc-attachment://notes/note-1/att-img');
    expect(result.droppedCount).toBe(0);
  });

  it('dedupes editor strip attachments with synced note attachments', async () => {
    const editor: NoteEditorAttachment[] = [{
      id: 'att1',
      type: 'image',
      name: 'pic.png',
      mimeType: 'image/png',
      size: 3,
      content: 'YWJj',
    }];
    const result = await collectNoteAttachmentsForChat('note-1', '', editor, []);
    expect(result.attachments).toHaveLength(1);
  });

  it('collects markdown local images inserted while offline', async () => {
    const local = createLocalNoteAttachment('note-1', {
      type: 'image',
      name: 'offline.png',
      mimeType: 'image/png',
      size: 3,
      content: 'YWJj',
    });

    const result = await collectNoteAttachmentsForChat('note-1', `![offline](${local.src})`, [], []);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      type: 'image',
      name: 'offline',
      mimeType: 'image/png',
      content: 'YWJj',
    });
  });

  it('collects markdown local documents inserted while offline', async () => {
    const local = createLocalNoteAttachment('note-1', {
      type: 'document',
      name: 'brief.pdf',
      mimeType: 'application/pdf',
      size: 3,
      content: 'YWJj',
    });

    const result = await collectNoteAttachmentsForChat('note-1', `[brief](${local.src})`, [], []);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      type: 'document',
      name: 'brief',
      mimeType: 'application/pdf',
      content: 'YWJj',
    });
  });

  it('uses canonical note attachment URI for synced attachments without local base64', async () => {
    const synced: NoteAttachment[] = [{
      id: 'remote',
      type: 'file',
      mimeType: 'application/pdf',
      fileName: 'doc.pdf',
      size: 100,
      relativePath: 'inbound/n/doc.pdf',
    }];
    const result = await collectNoteAttachmentsForChat('note-1', '', [], synced);
    expect(result.attachments[0].uri).toBe('xopc-attachment://notes/note-1/remote');
    expect(result.attachments[0].content).toBe('');
  });

  it('caps attachments to MAX_CHAT_ATTACHMENTS', async () => {
    const editor: NoteEditorAttachment[] = Array.from({ length: MAX_CHAT_ATTACHMENTS + 2 }, (_, index) => ({
      id: `att-${index}`,
      type: 'document' as const,
      name: `file-${index}.txt`,
      mimeType: 'text/plain',
      size: 4,
      content: btoa(`file-${index}`),
    }));
    const result = await collectNoteAttachmentsForChat('note-1', '', editor, []);
    expect(result.attachments).toHaveLength(MAX_CHAT_ATTACHMENTS);
    expect(result.droppedCount).toBe(2);
  });
});

describe('composerAttachmentsToWire for note media', () => {
  it('maps audio attachments to voice wire type with canonical uri', () => {
    const wire = composerAttachmentsToWire([
      {
        id: 'v1',
        type: 'document',
        name: 'voice.m4a',
        mimeType: 'audio/mp4',
        size: 100,
        content: '',
        uri: 'xopc-attachment://notes/note-1/v1',
        durationSeconds: 12,
      },
    ]);
    expect(wire).toEqual([
      {
        type: 'voice',
        mimeType: 'audio/mp4',
        name: 'voice.m4a',
        size: 100,
        uri: 'xopc-attachment://notes/note-1/v1',
        durationSeconds: 12,
      },
    ]);
  });
});
