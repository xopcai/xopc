/**
 * Notes quick-capture offline sync — backed by the unified OfflineQueue.
 *
 * Queues text, image, and voice captures when the network call fails.
 */
import { createOfflineQueue, type OfflineQueue, type QueuedOperation } from '../../sync';
import type { NoteKind } from '../../query/notes';
import { captureNote } from '../../query/notes';
import type { ComposerAttachment } from '../chat/composer.types';
import {
  captureNoteWithComposerAttachment,
  captureNoteWithQueuedVoice,
  type QueuedVoiceCapture,
} from './capture-note-media';
import { parseCaptureIntent } from './capture-parser';

export type CaptureQueuePayload =
  | { type: 'text'; text: string; kind?: NoteKind; channel?: 'app' | 'clipboard' | 'share' }
  | { type: 'attachment'; attachment: ComposerAttachment; text?: string }
  | ({ type: 'voice' } & QueuedVoiceCapture);

const captureQueue: OfflineQueue<CaptureQueuePayload> = createOfflineQueue<CaptureQueuePayload>({
  namespace: 'notes:capture',
  processor: async (operation: QueuedOperation<CaptureQueuePayload>) => {
    const { payload } = operation;
    if (payload.type === 'text') {
      await captureNote({
        text: payload.text,
        kind: payload.kind ?? parseCaptureIntent(payload.text).kind,
        channel: payload.channel,
      });
      return;
    }
    if (payload.type === 'attachment') {
      await captureNoteWithComposerAttachment(payload.attachment, payload.text);
      return;
    }
    await captureNoteWithQueuedVoice(payload);
  },
});

/** Queue a text note for later sync. Returns the operation ID. */
export function queueNote(text: string, kind?: NoteKind, channel?: 'app' | 'clipboard' | 'share'): string {
  return captureQueue.enqueue({
    type: 'text',
    text,
    kind: kind ?? parseCaptureIntent(text).kind,
    channel,
  });
}

/** Queue a media capture for later sync. Returns the operation ID. */
export function queueMediaCapture(payload: Exclude<CaptureQueuePayload, { type: 'text' }>): string {
  return captureQueue.enqueue(payload);
}

/** Flush all pending quick-capture notes. Returns count flushed. */
export async function flushPendingNotes(): Promise<number> {
  return captureQueue.flush();
}

/** Number of pending quick-capture notes waiting to sync. */
export function getPendingNoteCount(): number {
  return captureQueue.pendingCount();
}

/** All pending quick-capture payloads (for UI display). */
export function getPendingNotes(): Array<{ id: string; text: string; createdAt: number }> {
  return captureQueue.pending().map((op) => ({
    id: op.id,
    text: op.payload.type === 'text'
      ? op.payload.text
      : op.payload.type === 'attachment'
        ? `[image: ${op.payload.attachment.name}]`
        : `[voice: ${op.payload.name}]`,
    createdAt: op.createdAt,
  }));
}
