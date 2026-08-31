import type { ComposerAttachment } from '../chat/composer.types';
import { inferRecordingMimeType } from '../chat/voiceRecording';
import { transcribeVoice } from '../../api/agent-client';
import {
  captureNote,
  updateNote,
  type CaptureNoteAttachment,
  type CaptureNoteResult,
  type NoteAttachment,
  type NoteKind,
} from '../../query/notes';

export type QueuedVoiceCapture = {
  name: string;
  mimeType: string;
  localUri: string;
  durationMillis: number;
  transcript?: string;
};

export type VoiceCaptureOptions = {
  idempotencyKey?: string;
};

function kindForComposerAttachment(att: ComposerAttachment): NoteKind {
  if (att.type === 'image' || att.mimeType.startsWith('image/')) return 'media';
  return 'mixed';
}

function captureAttachmentFromComposer(att: ComposerAttachment): CaptureNoteAttachment {
  return {
    mimeType: att.mimeType,
    fileName: att.name,
    localUri: att.localUri,
    data: att.content || undefined,
  };
}

function noteAttachmentRef(noteId: string, attachmentId: string): string {
  return `xopc-attachment://notes/${encodeURIComponent(noteId)}/${encodeURIComponent(attachmentId)}`;
}

function escapeMarkdownLabel(label: string): string {
  return label.replace(/[\\[\]]/g, '\\$&');
}

function mediaMarkdownForAttachment(noteId: string, attachment: NoteAttachment): string {
  const label = escapeMarkdownLabel(attachment.fileName || 'attachment');
  const ref = noteAttachmentRef(noteId, attachment.id);
  if (attachment.type === 'image' || attachment.mimeType.startsWith('image/')) {
    return `![${label}](${ref})`;
  }
  return `[${label}](${ref})`;
}

function formatVoiceMemoLabel(durationSeconds?: number): string {
  if (!durationSeconds || !Number.isFinite(durationSeconds)) return 'Voice memo';
  const rounded = Math.max(1, Math.round(durationSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `Voice memo ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function voiceMarkdownForAttachment(noteId: string, attachment: NoteAttachment): string {
  return `[${formatVoiceMemoLabel(attachment.duration)}](${noteAttachmentRef(noteId, attachment.id)})`;
}

function appendMarkdownReference(markdown: string | undefined, reference: string): string {
  const trimmed = markdown?.trim() ?? '';
  if (!trimmed) return reference;
  if (trimmed.includes(reference)) return trimmed;
  return `${trimmed}\n\n${reference}`;
}

async function patchCaptureMarkdown(
  result: CaptureNoteResult,
  markdown: string,
  kind?: NoteKind,
): Promise<CaptureNoteResult> {
  try {
    const note = await updateNote(result.note.id, kind ? { markdown, kind } : { markdown });
    return { note };
  } catch {
    return result;
  }
}

export function voiceCaptureAttachment(params: {
  name: string;
  mimeType: string;
  localUri: string;
  durationMillis: number;
}): CaptureNoteAttachment {
  return {
    mimeType: params.mimeType,
    fileName: params.name,
    localUri: params.localUri,
    duration: Math.max(1, Math.round(params.durationMillis / 1000)),
  };
}

export async function captureNoteWithComposerAttachment(
  attachment: ComposerAttachment,
  text?: string,
): Promise<CaptureNoteResult> {
  const result = await captureNote({
    text: text?.trim() ?? '',
    kind: kindForComposerAttachment(attachment),
    attachments: [captureAttachmentFromComposer(attachment)],
  });
  const noteAttachment = result.note.attachments?.[0];
  if (!noteAttachment) return result;
  const reference = mediaMarkdownForAttachment(result.note.id, noteAttachment);
  const markdown = appendMarkdownReference(result.note.markdown ?? text, reference);
  return patchCaptureMarkdown(result, markdown);
}

export async function captureNoteWithVoice(payload: {
  uri: string;
  durationMillis: number;
  mimeType: string;
}, options: VoiceCaptureOptions = {}): Promise<CaptureNoteResult> {
  // Persist the original audio before invoking STT. A slow or unavailable
  // transcription provider must never prevent a voice memo from being saved.
  const queued = await prepareVoiceCapturePayload(payload, { transcribe: false });
  let result = await captureNoteWithQueuedVoice(queued, options);
  try {
    const transcription = await transcribeVoice(payload.uri, queued.mimeType);
    const transcript = transcription.text.trim();
    const attachment = result.note.attachments?.find((att) => att.type === 'audio')
      ?? result.note.attachments?.[0];
    if (transcript && attachment) {
      const reference = voiceMarkdownForAttachment(result.note.id, attachment);
      const markdown = appendMarkdownReference(transcript, reference);
      result = await patchCaptureMarkdown(result, markdown, 'voice');
    }
  } catch {
    // STT is enrichment. The original recording and its playable reference
    // have already been durably saved.
  }
  return result;
}

export async function prepareVoiceCapturePayload(payload: {
  uri: string;
  durationMillis: number;
  mimeType: string;
}, options: { transcribe?: boolean } = {}): Promise<QueuedVoiceCapture> {
  const mimeType = payload.mimeType || inferRecordingMimeType(payload.uri);
  const name = mimeType.includes('mpeg') ? 'voice.mp3' : 'voice.m4a';

  let transcript: string | undefined;
  if (options.transcribe !== false) {
    try {
      const result = await transcribeVoice(payload.uri, mimeType);
      transcript = result.text.trim() || undefined;
    } catch {
      /* STT optional — still save the recording */
    }
  }

  return {
    name,
    mimeType,
    localUri: payload.uri,
    durationMillis: payload.durationMillis,
    transcript,
  };
}

export async function captureNoteWithQueuedVoice(
  payload: QueuedVoiceCapture,
  options: VoiceCaptureOptions = {},
): Promise<CaptureNoteResult> {
  const result = await captureNote({
    text: payload.transcript ?? '',
    kind: 'voice',
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    attachments: [
      voiceCaptureAttachment({
        name: payload.name,
        mimeType: payload.mimeType,
        localUri: payload.localUri,
        durationMillis: payload.durationMillis,
      }),
    ],
  });
  const attachment = result.note.attachments?.find((att) => att.type === 'audio') ?? result.note.attachments?.[0];
  if (!attachment) return result;
  const reference = voiceMarkdownForAttachment(result.note.id, attachment);
  const markdown = appendMarkdownReference(result.note.markdown ?? payload.transcript, reference);
  if (options.idempotencyKey) {
    const note = await updateNote(result.note.id, { markdown, kind: 'voice' });
    return { note };
  }
  return patchCaptureMarkdown(result, markdown, 'voice');
}
