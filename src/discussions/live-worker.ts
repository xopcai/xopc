import { randomUUID } from 'node:crypto';

import { ObjectLinkService } from '../activity/service.js';
import type { Config } from '../config/schema.js';
import type { NotesService } from '../notes/service.js';
import type { ProjectService } from '../projects/project-service.js';
import { createLogger } from '../utils/logger.js';
import { isSTTAvailable, mergeSttConfigFromAppConfig, transcribe } from '../voice/stt/index.js';

import { enrichLiveDiscussion } from './analyzer.js';
import { acceptRankedProject, findExactProjectMention } from './project-inference.js';
import {
  claimNextDiscussionTranscriptSegment,
  completeDiscussionTranscriptSegment,
  getDiscussionCapture,
  listDiscussionTranscriptSegments,
  retryOrFailDiscussionTranscriptSegment,
  updateDiscussionCapture,
} from './repository.js';
import { assembleDiscussionTranscript } from './transcript.js';
import type { DiscussionCapture, DiscussionTranscriptSegment } from './types.js';

const log = createLogger('DiscussionLiveWorker');
const MAX_ATTEMPTS = 3;
const MIN_ENRICHMENT_CHARS = 80;

export interface DiscussionLiveWorkerDeps {
  notes: NotesService;
  projects: ProjectService;
  getConfig: () => Config;
  transcribeSegment?: (buffer: Buffer, signal?: AbortSignal) => Promise<{ text: string; provider: string }>;
  enrichTranscript?: typeof enrichLiveDiscussion;
  onTranscriptUpdated?: (segment: DiscussionTranscriptSegment) => void;
  onDiscussionUpdated?: (capture: DiscussionCapture) => void;
}

export class DiscussionLiveWorker {
  private readonly owner = randomUUID();
  private readonly objectLinks = new ObjectLinkService();
  private timer?: NodeJS.Timeout;
  private running = false;
  private stoppedWaiters: Array<() => void> = [];

  constructor(
    private readonly deps: DiscussionLiveWorkerDeps,
    private readonly intervalMs = 1_000,
    private readonly concurrency = 3,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!this.running) return;
    await new Promise<void>((resolve) => this.stoppedWaiters.push(resolve));
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.all(Array.from({ length: this.concurrency }, () => this.processOne()));
    } finally {
      this.running = false;
      const waiters = this.stoppedWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }

  private async processOne(): Promise<void> {
    const segment = claimNextDiscussionTranscriptSegment(this.owner);
    if (!segment) return;
    try {
      try {
        const result = this.deps.transcribeSegment
          ? await this.deps.transcribeSegment(segment.audioBuffer)
          : await this.transcribeSegment(segment.audioBuffer);
        const completed = completeDiscussionTranscriptSegment(
          segment.discussionId,
          segment.sequence,
          this.owner,
          result.text.trim(),
          result.provider,
        );
        if (!completed) return;
        this.deps.onTranscriptUpdated?.(completed);
        await this.enrichOnce(segment.discussionId).catch((error) => {
          log.warn({ err: error, discussionId: segment.discussionId }, 'Live discussion enrichment failed');
        });
      } catch (error) {
        const exhausted = segment.attemptCount >= MAX_ATTEMPTS;
        const message = error instanceof Error ? error.message : String(error);
        const updated = retryOrFailDiscussionTranscriptSegment(
          segment.discussionId,
          segment.sequence,
          this.owner,
          message,
          exhausted,
        );
        if (updated) this.deps.onTranscriptUpdated?.(updated);
        log.warn(
          { err: error, discussionId: segment.discussionId, sequence: segment.sequence, exhausted },
          `Live discussion transcription failed: ${message}`,
        );
      }
    } catch (error) {
      log.error({ err: error, discussionId: segment.discussionId }, 'Unexpected live transcription worker failure');
    }
  }

  private async transcribeSegment(buffer: Buffer, signal?: AbortSignal): Promise<{ text: string; provider: string }> {
    const config = this.deps.getConfig();
    const sttConfig = mergeSttConfigFromAppConfig(config.tools?.media?.audio, config.tools?.media);
    if (!isSTTAvailable(sttConfig)) throw new Error('STT is not configured');
    return transcribe(buffer, sttConfig, { mime: 'audio/wav', fileName: 'discussion-segment.wav', signal });
  }

  private async enrichOnce(discussionId: string): Promise<void> {
    const capture = getDiscussionCapture(discussionId);
    if (!capture || capture.generatedTitle || capture.status === 'cancelled' || capture.status === 'completed') return;
    const transcript = assembleDiscussionTranscript(listDiscussionTranscriptSegments(discussionId));
    if (transcript.length < MIN_ENRICHMENT_CHARS) return;
    const projects = this.deps.projects.list({ status: 'active', limit: 100 }).items;
    const enrichment = await (this.deps.enrichTranscript ?? enrichLiveDiscussion)({
      config: this.deps.getConfig(),
      transcript,
      projects: projects.map(({ id, name }) => ({ id, name })),
    });
    const exact = capture.projectId ? undefined : findExactProjectMention(transcript, projects);
    const ranked = capture.projectId ? undefined : acceptRankedProject(enrichment, projects);
    const inferred = exact
      ? { id: exact.id, score: 1, source: 'exact_name' as const }
      : ranked
        ? { ...ranked, source: 'model' as const }
        : undefined;
    const note = await this.deps.notes.getNote(capture.noteId);
    if (!note) throw new Error('Discussion note is missing');
    if (note.title?.startsWith('Discussion ·') && note.title !== enrichment.title) {
      const updatedNote = await this.deps.notes.updateNote(capture.noteId, { title: enrichment.title }, 'ai_edit');
      if (!updatedNote) throw new Error('Discussion note disappeared while applying the live title');
    }
    const updated = updateDiscussionCapture(discussionId, {
      generatedTitle: enrichment.title,
      ...(inferred ? {
        projectId: inferred.id,
        projectInferenceScore: inferred.score,
        projectInferenceSource: inferred.source,
      } : {}),
    }, [capture.status]);
    if (!updated) return;
    if (inferred) this.linkProject(updated, inferred.id);
    this.deps.onDiscussionUpdated?.(updated);
  }

  private linkProject(capture: DiscussionCapture, projectId: string): void {
    const project = this.deps.projects.get(projectId);
    if (!project) return;
    this.objectLinks.create({
      id: `discussion:${capture.id}:project`,
      from: { kind: 'note', id: capture.noteId },
      to: { kind: 'project', id: project.id, title: project.name },
      relation: 'belongs_to',
      source: 'agent',
    });
  }
}
