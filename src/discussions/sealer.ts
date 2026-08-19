import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { Config } from '../config/schema.js';
import type { NotesService } from '../notes/service.js';
import { createLogger } from '../utils/logger.js';
import { isSTTAvailable, mergeSttConfigFromAppConfig, transcribe } from '../voice/stt/index.js';

import {
  getDiscussionCapture,
  listDiscussionCaptures,
  listDiscussionTranscriptSegments,
  updateDiscussionCapture,
} from './repository.js';
import { assembleDiscussionTranscript } from './transcript.js';
import type { DiscussionCapture } from './types.js';

const log = createLogger('DiscussionSealer');
const UPLOAD_GRACE_MS = 2 * 60_000;

export interface DiscussionSealerDeps {
  notes: NotesService;
  getConfig: () => Config;
  transcribeRecording?: (
    buffer: Buffer,
    capture: DiscussionCapture,
    signal?: AbortSignal,
  ) => Promise<{ text: string; language?: string }>;
  onUpdated?: (capture: DiscussionCapture) => void;
}

export class DiscussionSealer {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly deps: DiscussionSealerDeps, private readonly intervalMs = 1_000) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const capture = [
        ...listDiscussionCaptures({ status: 'sealing', limit: 1 }).items,
        ...listDiscussionCaptures({ status: 'stopping', limit: 1 }).items,
      ][0];
      if (!capture) return;
      await this.sealWhenReady(capture, now);
    } finally {
      this.running = false;
    }
  }

  private async sealWhenReady(capture: DiscussionCapture, now: number): Promise<void> {
    const ageMs = now - (capture.recordingStoppedAt ?? now);
    if (!capture.audioAttachmentId) {
      if (ageMs >= UPLOAD_GRACE_MS) this.fail(capture, 'audio_upload', 'recording_missing', 'Original recording was not uploaded');
      return;
    }

    const segments = listDiscussionTranscriptSegments(capture.id);
    const expected = capture.expectedLastSequence ?? -1;
    const bySequence = new Map(segments.map((segment) => [segment.sequence, segment]));
    const missing = Array.from({ length: expected + 1 }, (_, sequence) => sequence)
      .filter((sequence) => !bySequence.has(sequence));
    const pending = segments.some((segment) => segment.status === 'uploaded' || segment.status === 'transcribing');
    if ((missing.length > 0 || pending) && ageMs < UPLOAD_GRACE_MS) return;

    const sealing = capture.status === 'sealing'
      ? capture
      : updateDiscussionCapture(capture.id, { status: 'sealing' }, ['stopping']);
    if (!sealing) return;

    try {
      const confirmed = segments.filter((segment) => segment.status === 'confirmed');
      const useSegments = expected >= 0
        && missing.length === 0
        && !pending
        && confirmed.length === expected + 1;
      const result = useSegments
        ? { text: assembleDiscussionTranscript(confirmed) }
        : await this.transcribeFullRecording(sealing);
      const text = result.text.trim();
      if (!text) throw new Error('Discussion transcription produced no text');
      const updated = updateDiscussionCapture(capture.id, {
        status: 'organizing',
        canonicalTranscript: text,
        canonicalTranscriptSha256: createHash('sha256').update(text).digest('hex'),
        transcriptLanguage: result.language,
        failureStage: undefined,
        failureCode: undefined,
        failureMessage: undefined,
      }, ['sealing']);
      if (!updated) throw new Error('Discussion changed while sealing transcript');
      this.deps.onUpdated?.(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.fail(sealing, 'transcript_sealing', 'transcript_sealing_failed', message);
    }
  }

  private async transcribeFullRecording(capture: DiscussionCapture): Promise<{ text: string; language?: string }> {
    const attachment = await this.deps.notes.getAttachmentPath(capture.noteId, capture.audioAttachmentId!);
    if (!attachment) throw new Error('Discussion audio file is missing');
    const buffer = await readFile(attachment.filePath);
    if (this.deps.transcribeRecording) return this.deps.transcribeRecording(buffer, capture);
    const config = this.deps.getConfig();
    const sttConfig = mergeSttConfigFromAppConfig(config.tools?.media?.audio, config.tools?.media);
    if (!isSTTAvailable(sttConfig)) throw new Error('STT is not configured');
    return transcribe(buffer, sttConfig, {
      mime: attachment.mimeType || capture.mimeType,
      fileName: attachment.fileName,
    });
  }

  private fail(
    capture: DiscussionCapture,
    stage: DiscussionCapture['failureStage'],
    code: string,
    message: string,
  ): void {
    const current = getDiscussionCapture(capture.id);
    if (!current || (current.status !== 'stopping' && current.status !== 'sealing')) return;
    const updated = updateDiscussionCapture(capture.id, {
      status: 'needs_attention',
      failureStage: stage,
      failureCode: code,
      failureMessage: message.slice(0, 1_000),
    }, [current.status]);
    if (updated) this.deps.onUpdated?.(updated);
    log.warn({ discussionId: capture.id, stage, code }, `Discussion sealing failed: ${message}`);
  }
}
