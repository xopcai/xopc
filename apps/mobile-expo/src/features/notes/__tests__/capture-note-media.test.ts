import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../query/notes', () => ({
  captureNote: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock('../../../api/agent-client', () => ({
  transcribeVoice: vi.fn(),
  refineVoiceTranscript: vi.fn(),
}));

vi.mock('../../chat/voiceRecording', () => ({
  inferRecordingMimeType: vi.fn(() => 'audio/mp4'),
}));

import { captureNote, updateNote } from '../../../query/notes';
import { transcribeVoice } from '../../../api/agent-client';
import {
  captureNoteWithComposerAttachment,
  captureNoteWithVoice,
  captureNoteWithQueuedVoice,
  prepareVoiceCapturePayload,
} from '../capture-note-media';

const mockedCaptureNote = vi.mocked(captureNote);
const mockedUpdateNote = vi.mocked(updateNote);
const mockedTranscribeVoice = vi.mocked(transcribeVoice);

describe('capture note media', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prepares queued voice payloads with a native URI and provider transcript', async () => {
    mockedTranscribeVoice.mockResolvedValue({
      text: ' raw note ',
      refinementAvailable: false,
    });

    await expect(prepareVoiceCapturePayload({
      uri: 'file:///tmp/voice.m4a',
      durationMillis: 2400,
      mimeType: 'audio/mp4',
    })).resolves.toEqual({
      name: 'voice.m4a',
      mimeType: 'audio/mp4',
      localUri: 'file:///tmp/voice.m4a',
      durationMillis: 2400,
      transcript: 'raw note',
    });
  });

  it('patches an image capture with a markdown attachment reference', async () => {
    mockedCaptureNote.mockResolvedValue({
      note: {
        id: 'note-1',
        markdown: '',
        attachments: [{
          id: 'att-1',
          type: 'image',
          mimeType: 'image/png',
          fileName: 'photo[1].png',
          size: 4,
          relativePath: 'photo.png',
        }],
      },
    });
    mockedUpdateNote.mockResolvedValue({
      id: 'note-1',
      kind: 'media',
      status: 'inbox',
      markdown: '![photo\\[1\\].png](xopc-attachment://notes/note-1/att-1)',
      createdAt: 1,
      updatedAt: 2,
      capturedVia: { channel: 'app' },
    });

    await captureNoteWithComposerAttachment({
      id: 'local-1',
      type: 'image',
      name: 'photo[1].png',
      mimeType: 'image/png',
      size: 4,
      content: 'ZGF0YQ==',
    });

    expect(mockedCaptureNote).toHaveBeenCalledWith({
      text: '',
      kind: 'media',
      attachments: [{
        mimeType: 'image/png',
        fileName: 'photo[1].png',
        localUri: undefined,
        data: 'ZGF0YQ==',
      }],
    });
    expect(mockedUpdateNote).toHaveBeenCalledWith('note-1', {
      markdown: '![photo\\[1\\].png](xopc-attachment://notes/note-1/att-1)',
    });
  });

  it('patches a voice capture with transcript text plus a voice attachment link', async () => {
    mockedCaptureNote.mockResolvedValue({
      note: {
        id: 'note-voice',
        markdown: 'call mom',
        attachments: [{
          id: 'audio-1',
          type: 'audio',
          mimeType: 'audio/mp4',
          fileName: 'voice.m4a',
          size: 8,
          relativePath: 'voice.m4a',
          duration: 3,
        }],
      },
    });
    mockedUpdateNote.mockResolvedValue({
      id: 'note-voice',
      kind: 'voice',
      status: 'inbox',
      markdown: 'call mom\n\n[Voice memo 0:03](xopc-attachment://notes/note-voice/audio-1)',
      createdAt: 1,
      updatedAt: 2,
      capturedVia: { channel: 'app' },
    });

    await captureNoteWithQueuedVoice({
      name: 'voice.m4a',
      mimeType: 'audio/mp4',
      localUri: 'file:///documents/voice.m4a',
      durationMillis: 3200,
      transcript: 'call mom',
    });

    expect(mockedCaptureNote).toHaveBeenCalledWith({
      text: 'call mom',
      kind: 'voice',
      attachments: [{
        mimeType: 'audio/mp4',
        fileName: 'voice.m4a',
        localUri: 'file:///documents/voice.m4a',
        duration: 3,
      }],
    });
    expect(mockedUpdateNote).toHaveBeenCalledWith('note-voice', {
      markdown: 'call mom\n\n[Voice memo 0:03](xopc-attachment://notes/note-voice/audio-1)',
      kind: 'voice',
    });
  });

  it('saves the original voice memo before optional transcription and uses an idempotency key', async () => {
    mockedCaptureNote.mockResolvedValue({
      note: {
        id: 'note-voice',
        markdown: '',
        attachments: [{
          id: 'audio-1',
          type: 'audio',
          mimeType: 'audio/mp4',
          fileName: 'voice.m4a',
          size: 6,
          relativePath: 'voice.m4a',
          duration: 2,
        }],
      },
    });
    mockedUpdateNote.mockImplementation(async (_id, patch) => ({
      id: 'note-voice',
      kind: 'voice',
      status: 'inbox',
      markdown: String(patch.markdown ?? ''),
      attachments: [{
        id: 'audio-1', type: 'audio', mimeType: 'audio/mp4', fileName: 'voice.m4a',
        size: 6, relativePath: 'voice.m4a', duration: 2,
      }],
      createdAt: 1,
      updatedAt: 2,
      capturedVia: { channel: 'app' },
    }));
    mockedTranscribeVoice.mockResolvedValue({
      text: 'remember this',
      refinementAvailable: false,
    });

    await captureNoteWithVoice({
      uri: 'file:///documents/voice.m4a',
      durationMillis: 2_000,
      mimeType: 'audio/mp4',
    }, { idempotencyKey: 'operation-1' });

    expect(mockedCaptureNote).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'voice',
      idempotencyKey: 'operation-1',
    }));
    expect(mockedCaptureNote.mock.invocationCallOrder[0])
      .toBeLessThan(mockedTranscribeVoice.mock.invocationCallOrder[0]);
    expect(mockedUpdateNote).toHaveBeenLastCalledWith('note-voice', {
      markdown: 'remember this\n\n[Voice memo 0:02](xopc-attachment://notes/note-voice/audio-1)',
      kind: 'voice',
    });
  });
});
