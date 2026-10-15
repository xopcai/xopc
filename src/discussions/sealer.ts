import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';

import type { Config } from '../config/schema.js';
import type { NotesService } from '../notes/service.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import { forEachNormalizedAudioSegment } from '../voice/audio/normalize.js';
import { decodeWavToMonoFloat32 } from '../voice/audio/wav.js';
import { isSTTAvailable, mergeSttConfigFromAppConfig, transcribe } from '../voice/stt/index.js';
import type { STTResult } from '../voice/stt/types.js';

import { missingAudioRanges, slicePcmWav } from './audio-repair.js';
import {
  assertProcessingRun, claimSealingCapture, ensureProcessingRun, failOrRetryProcessing,
  getProcessingRun, readCheckpoint, releaseSealingLease, renewSealingLease, resetProcessingRetry,
  saveCheckpoint, withProcessingDeadline,
} from './processing.js';
import type { ProcessingRun, RecoveredTranscriptSegment, TranscriptionCheckpoint } from './processing.js';
import { getRecordingJob } from './recordingJobs.js';
import { listDiscussionTranscriptSegments, updateDiscussionCapture } from './repository.js';
import { replaceTranscriptSegments, saveTranscriptRevision } from './revisions.js';
import { appendTranscriptWithoutOverlap, assembleDiscussionTranscript } from './transcript.js';
import type { DiscussionCapture } from './types.js';

const log = createLogger('DiscussionSealer');
const UPLOAD_GRACE_MS = 2 * 60_000;

type TranscriptionResult = { text: string; language?: string; segments?: RecoveredTranscriptSegment[] };
export interface DiscussionSealerDeps {
  processRecordingJob?: () => Promise<void>;
  notes: NotesService;
  getConfig: () => Config;
  transcribeRecording?: (filePath: string, capture: DiscussionCapture, signal?: AbortSignal) => Promise<{ text: string; language?: string }>;
  transcribeSegment?: (audio: Buffer, signal: AbortSignal) => Promise<STTResult>;
  requestTimeoutMs?: number;
  onUpdated?: (capture: DiscussionCapture) => void;
}

export class DiscussionSealer {
  private readonly owner = randomUUID();
  private timer?: NodeJS.Timeout;
  private running = false;
  private recordingRunning = false;
  private stopping = false;
  private controller?: AbortController;

  constructor(private readonly deps: DiscussionSealerDeps, private readonly intervalMs = 1_000) {}

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => void this.tick().catch(error => log.error({ err: error }, 'Discussion processing tick failed')), this.intervalMs);
    this.timer.unref();
    void this.tick().catch(error => log.error({ err: error }, 'Discussion processing tick failed'));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.controller?.abort(new Error('Discussion processing stopped'));
    while (this.running || this.recordingRunning) await new Promise(resolve => setTimeout(resolve, 10));
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.stopping) return;
    // Original assembly continues on later ticks even while another recording is transcribing.
    if (!this.recordingRunning) {
      this.recordingRunning = true;
      try { await this.deps.processRecordingJob?.(); }
      finally { this.recordingRunning = false; }
    }
    if (this.running || this.stopping) return;
    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    let capture: DiscussionCapture | null = null;
    let renewal: NodeJS.Timeout | undefined;
    try {
      capture = claimSealingCapture(this.owner, now);
      if (!capture) return;
      const id = capture.id;
      renewal = setInterval(() => { if (!renewSealingLease(id, this.owner)) controller.abort(new Error('Transcription lease lost')); }, 15_000);
      renewal.unref();
      await this.sealWhenReady(capture, now, controller.signal);
    } finally {
      if (renewal) clearInterval(renewal);
      if (capture) releaseSealingLease(capture.id, this.owner);
      this.controller = undefined;
      this.running = false;
    }
  }

  private async sealWhenReady(capture: DiscussionCapture, now: number, signal: AbortSignal): Promise<void> {
    const ageMs = now - (capture.recordingStoppedAt ?? now);
    if (!capture.audioAttachmentId) {
      const job = getRecordingJob(capture.id);
      if (job && (job.state === 'queued' || job.state === 'running')) return;
      if (ageMs >= UPLOAD_GRACE_MS) {
        const updated = updateDiscussionCapture(capture.id, { status: 'needs_attention', failureStage: 'audio_upload',
          failureCode: 'recording_missing', failureMessage: 'Original recording was not uploaded' }, ['stopping','sealing']);
        if (updated) this.deps.onUpdated?.(updated);
      }
      if (ageMs < UPLOAD_GRACE_MS) updateDiscussionCapture(capture.id, { updatedAt: Date.now() }, [capture.status]);
      return;
    }
    const segments = listDiscussionTranscriptSegments(capture.id);
    const expected = capture.expectedLastSequence ?? -1;
    const missing = expected >= 0 && Array.from({ length: expected + 1 }, (_, sequence) => sequence)
      .some(sequence => !segments.some(segment => segment.sequence === sequence));
    const pending = segments.some(segment => segment.status === 'uploaded' || segment.status === 'transcribing');
    const run = ensureProcessingRun(capture);
    // A forced generation reads saved audio immediately and never waits for old live-STT work.
    if (!run.force_audio && (missing || pending) && ageMs < UPLOAD_GRACE_MS) {
      updateDiscussionCapture(capture.id, { updatedAt: Date.now() }, [capture.status]);
      return;
    }
    const sealing = capture.status === 'sealing' ? capture : updateDiscussionCapture(capture.id, { status: 'sealing' }, ['stopping']);
    if (!sealing) return;
    try {
      const confirmed = segments.filter(segment => segment.status === 'confirmed');
      const useSegments = !run.force_audio && expected >= 0 && !missing && !pending && confirmed.length === expected + 1;
      const result: TranscriptionResult = useSegments ? { text: assembleDiscussionTranscript(confirmed) }
        : await this.transcribeFullRecording(sealing, run, signal);
      const text = result.text.trim();
      if (!text) throw new Error('Discussion transcription produced no text');
      const updated = runSqliteWriteTransaction(() => {
        assertProcessingRun(run, this.owner, signal);
        if (result.segments) replaceTranscriptSegments(capture.id, result.segments);
        saveTranscriptRevision(capture.id);
        resetProcessingRetry(capture.id);
        return updateDiscussionCapture(capture.id, { status: 'organizing', canonicalTranscript: text,
          canonicalTranscriptSha256: createHash('sha256').update(text).digest('hex'), transcriptLanguage: result.language,
          failureStage: undefined, failureCode: undefined, failureMessage: undefined }, ['sealing']);
      });
      if (updated) this.deps.onUpdated?.(updated);
    } catch (error) {
      if (signal.aborted) return;
      // A newer run or worker owns the publication boundary; it must not be marked failed by this worker.
      if (getProcessingRun(capture.id)?.run_id !== run.run_id || !renewSealingLease(capture.id, this.owner)) return;
      const updated = failOrRetryProcessing(sealing, 'transcript_sealing', error);
      if (updated) this.deps.onUpdated?.(updated);
      log.warn({ err: error, discussionId: capture.id, phase: 'transcript_sealing' }, 'Discussion transcription failed; saved original retained');
    }
  }

  private async transcribeFullRecording(capture: DiscussionCapture, run: ProcessingRun, signal: AbortSignal): Promise<TranscriptionResult> {
    const attachment = await this.deps.notes.getAttachmentPath(capture.noteId, capture.audioAttachmentId!);
    if (!attachment) throw new Error('Discussion audio file is missing');
    const assertCurrent = () => assertProcessingRun(run, this.owner, signal);
    assertCurrent();
    if (capture.audioSha256) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(attachment.filePath)) { signal.throwIfAborted(); hash.update(chunk); }
      if (hash.digest('hex') !== capture.audioSha256) throw new Error('Saved original audio checksum mismatch');
    }
    assertCurrent();
    if (this.deps.transcribeRecording) {
      if (listDiscussionTranscriptSegments(capture.id).some(segment => segment.correctedByUser)) {
        throw new Error('Segment transcription is required to preserve manual corrections');
      }
      const cached = readCheckpoint(run.run_id, 0, capture.durationMs ?? 1_000);
      const result = cached ?? await withProcessingDeadline(async requestSignal => {
        const response = await this.deps.transcribeRecording!(attachment.filePath, capture, requestSignal);
        return { segments: [{ text: response.text, startedAtMs: 0, endedAtMs: capture.durationMs ?? 1_000 }], language: response.language };
      }, signal, this.deps.requestTimeoutMs ?? 120_000);
      assertCurrent();
      if (!cached) saveCheckpoint(run.run_id, 0, capture.durationMs ?? 1_000, result);
      return { text: result.segments.map(segment => segment.text).join('\n'), language: result.language, segments: result.segments };
    }
    const config = this.deps.getConfig();
    const sttConfig = mergeSttConfigFromAppConfig(config.tools?.media?.audio, config.tools?.media);
    if (!this.deps.transcribeSegment && !isSTTAvailable(sttConfig)) throw new Error('STT is not configured');
    const confirmed = listDiscussionTranscriptSegments(capture.id).filter(segment => segment.status === 'confirmed' && (!run.force_audio || segment.correctedByUser));
    const output: RecoveredTranscriptSegment[] = confirmed.map(segment => ({ text: segment.displayText ?? segment.rawText ?? '',
      rawText: segment.rawText, startedAtMs: segment.startedAtMs, endedAtMs: segment.endedAtMs,
      speakerLabel: segment.speakerLabel, correctedByUser: segment.correctedByUser }));
    let offset = 0;
    let language: string | undefined;
    await forEachNormalizedAudioSegment({ filePath: attachment.filePath, maxDurationSeconds: 120 * 60, signal }, async (buffer, index) => {
      assertCurrent();
      const decoded = decodeWavToMonoFloat32(buffer);
      const durationMs = decoded.durationSeconds * 1_000;
      const gaps = missingAudioRanges(offset, offset + durationMs, confirmed);
      for (const [gapIndex, gap] of gaps.entries()) {
        assertCurrent();
        let checkpoint = readCheckpoint(run.run_id, gap.startedAtMs, gap.endedAtMs);
        if (!checkpoint) {
          const audio = gaps.length === 1 && gap.startedAtMs === offset && gap.endedAtMs === offset + durationMs
            ? buffer : slicePcmWav(decoded, gap.startedAtMs - offset, gap.endedAtMs - offset);
          if (audio.length <= 44) continue;
          const result = await withProcessingDeadline(requestSignal => this.deps.transcribeSegment
            ? this.deps.transcribeSegment(audio, requestSignal)
            : transcribe(audio, sttConfig, { mime: 'audio/wav', fileName: `discussion-recovery-${index}-${gapIndex}.wav`, signal: requestSignal }),
          signal, this.deps.requestTimeoutMs ?? 120_000);
          const recovered: RecoveredTranscriptSegment[] = [];
          if (result.segments?.length) {
            for (const part of result.segments) {
              if (!Number.isFinite(part.startMs) || !Number.isFinite(part.endMs) || part.startMs < 0 || part.endMs <= part.startMs
                || part.endMs > gap.endedAtMs - gap.startedAtMs + 100) throw new Error('Provider returned an invalid transcript time range');
              recovered.push({ text: part.text, startedAtMs: gap.startedAtMs + part.startMs,
                endedAtMs: Math.min(gap.endedAtMs, gap.startedAtMs + part.endMs), ...(part.speaker ? { speakerLabel: `${index + 1}:${gapIndex + 1}:${part.speaker}` } : {}) });
            }
          } else if (result.text.trim()) recovered.push({ text: result.text, ...gap });
          checkpoint = { segments: recovered, language: result.language } satisfies TranscriptionCheckpoint;
          assertCurrent();
          saveCheckpoint(run.run_id, gap.startedAtMs, gap.endedAtMs, checkpoint);
        }
        output.push(...checkpoint.segments);
        language ??= checkpoint.language;
      }
      offset += durationMs;
    });
    output.sort((a, b) => a.startedAtMs - b.startedAtMs);
    // Use the same transcript assembly rules while keeping publication atomic until all chunks succeed.
    const text = output.reduce((text, segment) => appendTranscriptWithoutOverlap(text, segment.text), '');
    return { text, language, segments: output };
  }
}
