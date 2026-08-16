import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ObjectLinkService } from '../activity/service.js';
import type { Config } from '../config/schema.js';
import { buildNoteAttachmentRef } from '../notes/attachment-ref.js';
import type { NotesService } from '../notes/service.js';
import type { ProjectService } from '../projects/project-service.js';
import { isSTTAvailable, mergeSttConfigFromAppConfig, transcribe } from '../voice/stt/index.js';

import { analyzeDiscussion } from './analyzer.js';
import { acceptRankedProject, findExactProjectMention } from './project-inference.js';
import { deleteDiscussionSegmentAudio, updateDiscussionCapture } from './repository.js';
import type { DiscussionAnalysis, DiscussionCapture } from './types.js';

const MANAGED_START = '<!-- xopc:discussion-analysis:start -->';
const MANAGED_END = '<!-- xopc:discussion-analysis:end -->';

export interface DiscussionTranscriptionResult {
  text: string;
  provider: string;
  language?: string;
}

export interface DiscussionPipelineDeps {
  notes: NotesService;
  projects: ProjectService;
  getConfig: () => Config;
  transcribeAudio?: (buffer: Buffer, capture: DiscussionCapture, signal?: AbortSignal) => Promise<DiscussionTranscriptionResult>;
  analyzeTranscript?: (transcript: string, capture: DiscussionCapture, signal?: AbortSignal) => Promise<{ analysis: DiscussionAnalysis; modelRef: string }>;
  onUpdated?: (capture: DiscussionCapture) => void;
  onCompleted?: (capture: DiscussionCapture, analysis: DiscussionAnalysis) => void;
}

function list(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '- None identified';
}

function renderManagedSection(transcript: string, analysis: DiscussionAnalysis): string {
  const actions = analysis.actionItems.length > 0
    ? analysis.actionItems.map((item) => {
      const metadata = [item.owner ? `Owner: ${item.owner}` : '', item.dueDate ? `Due: ${item.dueDate}` : '']
        .filter(Boolean).join(' · ');
      return `- [ ] ${item.title}${metadata ? ` — ${metadata}` : ''}`;
    }).join('\n')
    : '- None identified';
  return [
    MANAGED_START,
    '## Summary',
    analysis.summary,
    '',
    '## Key points',
    list(analysis.keyPoints),
    '',
    '## Decisions',
    list(analysis.decisions),
    '',
    '## Action items',
    actions,
    '',
    '## Risks',
    list(analysis.risks),
    '',
    '## Open questions',
    list(analysis.openQuestions),
    '',
    '## Transcript',
    transcript.trim(),
    MANAGED_END,
  ].join('\n');
}

export function mergeDiscussionAnalysisIntoMarkdown(
  markdown: string,
  transcript: string,
  analysis: DiscussionAnalysis,
  audioRef?: string,
): string {
  const managed = renderManagedSection(transcript, analysis);
  const withoutPlaceholder = markdown
    .replace(/^> Recording in progress\. Live transcript will appear here\.\s*$/gm, '')
    .replace(/^> Finalizing recording\.\.\.\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const start = withoutPlaceholder.indexOf(MANAGED_START);
  const end = withoutPlaceholder.indexOf(MANAGED_END);
  const base = start >= 0 && end >= start
    ? `${withoutPlaceholder.slice(0, start).trimEnd()}\n\n${managed}${withoutPlaceholder.slice(end + MANAGED_END.length)}`.trim()
    : `${withoutPlaceholder}\n\n${managed}`.trim();
  return audioRef && !base.includes(`](${audioRef})`) ? `${base}\n\n[Discussion audio](${audioRef})` : base;
}

export class DiscussionPipeline {
  private readonly objectLinks = new ObjectLinkService();

  constructor(private readonly deps: DiscussionPipelineDeps) {}

  async process(capture: DiscussionCapture, owner: string, signal?: AbortSignal): Promise<DiscussionCapture> {
    let current = capture;
    if (!current.transcriptRaw) current = await this.transcribe(current, owner, signal);
    if (!current.analysis) current = await this.analyze(current, owner, signal);
    return this.writeNote(current, owner);
  }

  private async transcribe(capture: DiscussionCapture, owner: string, signal?: AbortSignal): Promise<DiscussionCapture> {
    if (!capture.audioAttachmentId) throw new Error('Discussion audio attachment is missing');
    const attachment = await this.deps.notes.getAttachmentPath(capture.noteId, capture.audioAttachmentId);
    if (!attachment) throw new Error('Discussion audio file is missing');
    const buffer = await readFile(attachment.filePath);
    const result = this.deps.transcribeAudio
      ? await this.deps.transcribeAudio(buffer, capture, signal)
      : await this.defaultTranscribe(buffer, capture, attachment, signal);
    const transcript = result.text.trim();
    if (!transcript) throw new Error('Discussion transcription produced no text');
    const updated = updateDiscussionCapture(capture.id, {
      processingStage: 'analysis',
      transcriptRaw: transcript,
      transcriptSha256: createHash('sha256').update(transcript).digest('hex'),
      transcriptLanguage: result.language,
      sttProvider: result.provider,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      leaseOwner: owner,
      leaseExpiresAt: Date.now() + 5 * 60_000,
    }, ['finalizing']);
    if (!updated) throw new Error('Discussion changed while transcribing');
    this.deps.onUpdated?.(updated);
    return updated;
  }

  private async analyze(capture: DiscussionCapture, owner: string, signal?: AbortSignal): Promise<DiscussionCapture> {
    if (!capture.transcriptRaw) throw new Error('Discussion transcript is missing');
    const projects = this.deps.projects.list({ status: 'active', limit: 100 }).items;
    const result = this.deps.analyzeTranscript
      ? await this.deps.analyzeTranscript(capture.transcriptRaw, capture, signal)
      : await analyzeDiscussion({
        config: this.deps.getConfig(),
        transcript: capture.transcriptRaw,
        projects: projects.map(({ id, name }) => ({ id, name })),
        signal,
      });
    const analysis = result.analysis;
    let inferredProject: { id: string; score: number; source: 'exact_name' | 'model' } | undefined;
    if (!capture.projectId) {
      const exact = findExactProjectMention(capture.transcriptRaw, projects);
      const ranked = acceptRankedProject(analysis, projects);
      if (exact) inferredProject = { id: exact.id, score: 1, source: 'exact_name' };
      else if (ranked) inferredProject = { ...ranked, source: 'model' };
    }
    const updated = updateDiscussionCapture(capture.id, {
      processingStage: 'note_write',
      analysis,
      analysisInputHash: capture.transcriptSha256,
      analyzerModelRef: result.modelRef,
      generatedTitle: analysis.title,
      ...(inferredProject ? {
        projectId: inferredProject.id,
        projectInferenceScore: inferredProject.score,
        projectInferenceSource: inferredProject.source,
      } : {}),
      leaseOwner: owner,
      leaseExpiresAt: Date.now() + 5 * 60_000,
    }, ['finalizing']);
    if (!updated) throw new Error('Discussion changed while analyzing');
    if (inferredProject) this.linkProject(updated, inferredProject.id);
    this.deps.onUpdated?.(updated);
    return updated;
  }

  private async writeNote(capture: DiscussionCapture, owner: string): Promise<DiscussionCapture> {
    if (!capture.transcriptRaw || !capture.analysis || !capture.audioAttachmentId) {
      throw new Error('Discussion finalization data is incomplete');
    }
    const note = await this.deps.notes.getNote(capture.noteId);
    if (!note) throw new Error('Discussion note is missing');
    const title = capture.analysis.title.trim().slice(0, 200);
    const audioRef = buildNoteAttachmentRef(capture.noteId, capture.audioAttachmentId);
    const markdown = mergeDiscussionAnalysisIntoMarkdown(note.markdown, capture.transcriptRaw, capture.analysis, audioRef);
    const attachments = (note.attachments ?? []).map((attachment) =>
      attachment.id === capture.audioAttachmentId ? { ...attachment, transcript: capture.transcriptRaw } : attachment,
    );
    if (capture.projectId && capture.projectInferenceSource !== 'context') {
      this.linkProject(capture, capture.projectId);
    }
    if (note.title !== title || note.markdown !== markdown || note.status !== 'processed') {
      await this.deps.notes.updateNote(capture.noteId, { title, markdown, attachments, status: 'processed' }, 'ai_edit');
    }
    const now = Date.now();
    const updated = updateDiscussionCapture(capture.id, {
      status: 'completed',
      processingStage: undefined,
      finalizationRevision: capture.finalizationRevision + 1,
      completedAt: now,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
    }, ['finalizing']);
    if (!updated || updated.leaseOwner) throw new Error('Discussion changed while writing the note');
    deleteDiscussionSegmentAudio(capture.id);
    this.deps.onUpdated?.(updated);
    this.deps.onCompleted?.(updated, capture.analysis);
    return updated;
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

  private async defaultTranscribe(
    buffer: Buffer,
    capture: DiscussionCapture,
    attachment: { mimeType: string; fileName: string },
    signal?: AbortSignal,
  ): Promise<DiscussionTranscriptionResult> {
    const config = this.deps.getConfig();
    const sttConfig = mergeSttConfigFromAppConfig(config.tools?.media?.audio, config.tools?.media);
    if (!isSTTAvailable(sttConfig)) throw new Error('STT is not configured');
    return transcribe(buffer, sttConfig, {
      mime: attachment.mimeType || capture.mimeType,
      fileName: attachment.fileName,
      signal,
    });
  }
}
