import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { Config } from '../config/schema.js';
import type { NotesService } from '../notes/service.js';
import { isSTTAvailable, mergeSttConfigFromAppConfig, transcribe } from '../voice/stt/index.js';

import { analyzeDiscussion } from './analyzer.js';
import { updateDiscussionCapture } from './repository.js';
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
  getConfig: () => Config;
  transcribeAudio?: (buffer: Buffer, capture: DiscussionCapture, signal?: AbortSignal) => Promise<DiscussionTranscriptionResult>;
  analyzeTranscript?: (transcript: string, capture: DiscussionCapture, signal?: AbortSignal) => Promise<{ analysis: DiscussionAnalysis; modelRef: string }>;
  onUpdated?: (capture: DiscussionCapture) => void;
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
): string {
  const managed = renderManagedSection(transcript, analysis);
  const withoutPlaceholders = markdown
    .replace(/^> Waiting for the discussion recording to be uploaded\.\s*$/gm, '')
    .replace(/^> Recording uploaded\. Processing will start shortly\.\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const start = withoutPlaceholders.indexOf(MANAGED_START);
  const end = withoutPlaceholders.indexOf(MANAGED_END);
  if (start >= 0 && end >= start) {
    return `${withoutPlaceholders.slice(0, start).trimEnd()}\n\n${managed}${withoutPlaceholders.slice(end + MANAGED_END.length)}`.trim();
  }
  return `${withoutPlaceholders}\n\n${managed}`.trim();
}

export class DiscussionPipeline {
  constructor(private readonly deps: DiscussionPipelineDeps) {}

  async process(capture: DiscussionCapture, owner: string, signal?: AbortSignal): Promise<DiscussionCapture> {
    let current = capture;
    if (!current.transcriptRaw) current = await this.transcribe(current, owner, signal);
    return this.analyze(current, owner, signal);
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
      status: 'analyzing',
      transcriptRaw: transcript,
      transcriptSha256: createHash('sha256').update(transcript).digest('hex'),
      transcriptLanguage: result.language,
      sttProvider: result.provider,
      failedStage: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      leaseOwner: owner,
      leaseExpiresAt: Date.now() + 5 * 60_000,
    }, ['transcribing']);
    if (!updated) throw new Error('Discussion changed while transcribing');
    await this.persistAttachmentTranscript(updated, transcript);
    this.deps.onUpdated?.(updated);
    return updated;
  }

  private async analyze(capture: DiscussionCapture, owner: string, signal?: AbortSignal): Promise<DiscussionCapture> {
    if (!capture.transcriptRaw) throw new Error('Discussion transcript is missing');
    const result = this.deps.analyzeTranscript
      ? await this.deps.analyzeTranscript(capture.transcriptRaw, capture, signal)
      : await analyzeDiscussion({
        config: this.deps.getConfig(),
        transcript: capture.transcriptRaw,
        languageHint: capture.languageHint,
        signal,
      });
    const note = await this.deps.notes.getNote(capture.noteId);
    if (!note) throw new Error('Discussion note is missing');
    await this.deps.notes.updateNote(capture.noteId, {
      markdown: mergeDiscussionAnalysisIntoMarkdown(note.markdown, capture.transcriptRaw, result.analysis),
    }, 'ai_edit');
    const updated = updateDiscussionCapture(capture.id, {
      status: 'review_required',
      analysis: result.analysis,
      analysisVersion: capture.analysisVersion + 1,
      analysisInputHash: capture.transcriptSha256 ?? createHash('sha256').update(capture.transcriptRaw).digest('hex'),
      analyzerModelRef: result.modelRef,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      failedStage: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
    }, ['analyzing']);
    if (!updated) throw new Error('Discussion changed while analyzing');
    this.deps.onUpdated?.(updated);
    return updated;
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
      language: capture.languageHint === 'auto' ? undefined : capture.languageHint,
      mime: attachment.mimeType || capture.mimeType,
      fileName: attachment.fileName,
      signal,
    });
  }

  private async persistAttachmentTranscript(capture: DiscussionCapture, transcript: string): Promise<void> {
    const note = await this.deps.notes.getNote(capture.noteId);
    if (!note || !capture.audioAttachmentId) return;
    const attachments = (note.attachments ?? []).map((attachment) =>
      attachment.id === capture.audioAttachmentId ? { ...attachment, transcript } : attachment,
    );
    await this.deps.notes.updateNote(capture.noteId, { attachments }, 'ai_edit');
  }
}
