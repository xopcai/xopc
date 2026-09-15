import { createHash } from 'node:crypto';
import type { Config } from '../config/schema.js';
import type { NotesService } from '../notes/service.js';
import { createLogger } from '../utils/logger.js';
import { isSTTAvailable, mergeSttConfigFromAppConfig, transcribe } from '../voice/stt/index.js';
import { forEachNormalizedAudioSegment } from '../voice/audio/normalize.js';

import {
  getDiscussionCapture,
  listDiscussionCaptures,
  listDiscussionTranscriptSegments,
  updateDiscussionCapture,
} from './repository.js';
import { decodeWavToMonoFloat32 } from '../voice/local/wav.js';
import { replaceTranscriptSegments, saveTranscriptRevision } from './revisions.js';
import { missingAudioRanges, slicePcmWav } from './audio-repair.js';
import { assembleDiscussionTranscript } from './transcript.js';
import type { DiscussionCapture } from './types.js';
import { getRecordingJob } from './recordingJobs.js';

const log = createLogger('DiscussionSealer');
const UPLOAD_GRACE_MS = 2 * 60_000;

export interface DiscussionSealerDeps {
  processRecordingJob?: () => Promise<void>;
  notes: NotesService;
  getConfig: () => Config;
  transcribeRecording?: (
    filePath: string,
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
      await this.deps.processRecordingJob?.();
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
      const job = getRecordingJob(capture.id);
      if (job && (job.state === 'queued' || job.state === 'running')) return;
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
      saveTranscriptRevision(capture.id);
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
    if (this.deps.transcribeRecording) {
      const result = await this.deps.transcribeRecording(attachment.filePath, capture);
      replaceTranscriptSegments(capture.id, [{ text: result.text, startedAtMs: 0, endedAtMs: capture.durationMs ?? 1_000 }]);
      return result;
    }
    const config = this.deps.getConfig();
    const sttConfig = mergeSttConfigFromAppConfig(config.tools?.media?.audio, config.tools?.media);
    if (!isSTTAvailable(sttConfig)) throw new Error('STT is not configured');
    let offset = 0;
    const confirmed = listDiscussionTranscriptSegments(capture.id).filter(segment => segment.status === 'confirmed');
    const segments: Array<{ text: string; startedAtMs: number; endedAtMs: number; speakerLabel?: string; correctedByUser?: boolean; rawText?: string }> = confirmed.map(segment => ({
      text: segment.displayText ?? segment.rawText ?? '', rawText: segment.rawText,
      startedAtMs: segment.startedAtMs, endedAtMs: segment.endedAtMs,
      speakerLabel: segment.speakerLabel, correctedByUser: segment.correctedByUser,
    }));
    let language: string | undefined;
    await forEachNormalizedAudioSegment({ filePath: attachment.filePath, maxDurationSeconds: 120 * 60 }, async (buffer, index) => {
      const decoded = decodeWavToMonoFloat32(buffer);
      const durationMs = decoded.durationSeconds * 1_000;
      const gaps = missingAudioRanges(offset, offset + durationMs, confirmed);
      for (const [gapIndex, gap] of gaps.entries()) {
        const audio = gaps.length === 1 && gap.startedAtMs === offset && gap.endedAtMs === offset + durationMs
          ? buffer : slicePcmWav(decoded, gap.startedAtMs - offset, gap.endedAtMs - offset);
        if (audio.length <= 44) continue;
        const result = await transcribe(audio, sttConfig, { mime: 'audio/wav', fileName: `discussion-recovery-${index}-${gapIndex}.wav` });
        if (result.segments?.length) {
          for (const part of result.segments) {
            if (!Number.isFinite(part.startMs) || !Number.isFinite(part.endMs) || part.startMs < 0 || part.endMs <= part.startMs || part.endMs > gap.endedAtMs - gap.startedAtMs + 100) throw new Error('Provider returned an invalid transcript time range');
            segments.push({ text: part.text, startedAtMs: gap.startedAtMs + part.startMs, endedAtMs: Math.min(gap.endedAtMs, gap.startedAtMs + part.endMs), ...(part.speaker ? { speakerLabel: `${index + 1}:${gapIndex + 1}:${part.speaker}` } : {}) });
          }
        } else if (result.text.trim()) segments.push({ text: result.text, ...gap });
        language ??= result.language;
      }
      offset += durationMs;
    });
    segments.sort((a, b) => a.startedAtMs - b.startedAtMs);
    replaceTranscriptSegments(capture.id, segments);
    const text = assembleDiscussionTranscript(listDiscussionTranscriptSegments(capture.id));
    return { text, ...(language ? { language } : {}) };
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
