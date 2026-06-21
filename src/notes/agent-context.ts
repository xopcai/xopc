import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import type { ImageContent } from '@earendil-works/pi-ai';

import type { Config } from '../config/schema.js';
import type { AgentSourceContext } from '../agent/source-context/types.js';
import { getNoteAgentContextRecord, upsertNoteAgentContextRecord } from '../storage/sqlite/index.js';
import { mergeSttConfigFromAppConfig } from '../channels/attachments/voice-stt-webchat.js';
import { extractDocumentText } from '../document-understanding/extract.js';
import { describeImagesWithFallback } from '../agent/image/understanding/runtime.js';
import { resolveImageModelConfigForTool } from '../agent/image/tool-model-config.js';
import { isSTTAvailable, transcribe } from '../voice/stt/index.js';
import type { Note, NoteAttachment, SnapshotTrigger } from './types.js';

const MAX_NOTE_MARKDOWN_CHARS = 40_000;
const MAX_TEXT_ATTACHMENT_CHARS = 20_000;
const MAX_TOTAL_CONTEXT_CHARS = 80_000;
const MAX_NATIVE_VISION_IMAGES = 4;
const MAX_NATIVE_VISION_IMAGE_BYTES = 8 * 1024 * 1024;

export interface NoteAgentAttachmentContext {
  attachmentId: string;
  type: NoteAttachment['type'];
  fileName: string;
  mimeType: string;
  size: number;
  status: 'ready' | 'unsupported' | 'failed';
  summary?: string;
  transcript?: string;
  extractedText?: string;
  error?: string;
}

export interface NoteAgentContextArtifact {
  noteId: string;
  noteUpdatedAt: number;
  contextVersion: string;
  generatedAt: number;
  text: string;
  attachments: NoteAgentAttachmentContext[];
  tokenEstimate: number;
  truncated: boolean;
  status: 'ready' | 'partial' | 'failed';
}

interface NoteAgentContextNotesService {
  getAttachmentPath(noteId: string, attachmentId: string): Promise<{ filePath: string; mimeType: string; fileName: string } | null>;
  updateNote(id: string, patch: Partial<Note>, trigger?: SnapshotTrigger): Promise<Note | null>;
}

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_TYPES = new Set([
  'application/json', 'application/ld+json', 'application/xml', 'application/yaml', 'application/x-yaml',
  'application/javascript', 'application/typescript',
]);
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.log', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.sql',
]);
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`, truncated: true };
}

function isTextLikeAttachment(att: NoteAttachment): boolean {
  const mime = att.mimeType.toLowerCase();
  if (TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) return true;
  if (TEXT_MIME_TYPES.has(mime)) return true;
  return TEXT_EXTENSIONS.has(extname(att.fileName).toLowerCase());
}

function isDocumentAttachment(att: NoteAttachment): boolean {
  const mime = att.mimeType.toLowerCase();
  return mime === 'application/pdf'
    || mime.includes('officedocument')
    || DOCUMENT_EXTENSIONS.has(extname(att.fileName).toLowerCase());
}

function formatTime(ms: number | undefined): string {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : 'unknown';
}

async function readAttachmentBuffer(notesService: NoteAgentContextNotesService, noteId: string, att: NoteAttachment): Promise<Buffer | null> {
  const located = await notesService.getAttachmentPath(noteId, att.id);
  if (!located) return null;
  return readFile(located.filePath).catch(() => null);
}

async function attachmentTextExcerpt(notesService: NoteAgentContextNotesService, noteId: string, att: NoteAttachment): Promise<string | null> {
  if (!isTextLikeAttachment(att)) return null;
  const located = await notesService.getAttachmentPath(noteId, att.id);
  if (!located) return null;
  const raw = await readFile(located.filePath, 'utf8').catch(() => null);
  if (raw === null) return null;
  return truncateText(raw, MAX_TEXT_ATTACHMENT_CHARS).text;
}

async function ensureMediaTranscript(params: {
  note: Note;
  att: NoteAttachment;
  notesService: NoteAgentContextNotesService;
  config?: Config;
}): Promise<string | undefined> {
  const existing = params.att.transcript?.trim();
  if (existing) return existing;
  if (params.att.type !== 'audio' && params.att.type !== 'video') return undefined;

  const sttConfig = mergeSttConfigFromAppConfig(params.config?.tools?.media?.audio, params.config?.tools?.media);
  if (!isSTTAvailable(sttConfig)) return undefined;
  const buffer = await readAttachmentBuffer(params.notesService, params.note.id, params.att);
  if (!buffer) return undefined;
  const result = await transcribe(buffer, sttConfig);
  const transcript = result.text?.trim();
  if (!transcript) return undefined;
  const attachments = (params.note.attachments ?? []).map((item) =>
    item.id === params.att.id ? { ...item, transcript } : item,
  );
  await params.notesService.updateNote(params.note.id, { attachments }, 'ai_edit').catch(() => null);
  params.att.transcript = transcript;
  return transcript;
}

async function describeImageAttachment(params: {
  note: Note;
  att: NoteAttachment;
  notesService: NoteAgentContextNotesService;
  config?: Config;
}): Promise<string | undefined> {
  const toolCfg = resolveImageModelConfigForTool({ cfg: params.config });
  const primary = toolCfg?.primary;
  if (!primary) return undefined;
  const buffer = await readAttachmentBuffer(params.notesService, params.note.id, params.att);
  if (!buffer) return undefined;
  const result = await describeImagesWithFallback({
    modelRef: primary,
    fallbacks: toolCfg.fallbacks ?? [],
    images: [{ buffer, mimeType: params.att.mimeType }],
    prompt: `Describe this note attachment for later AI discussion. File name: ${params.att.fileName}. Focus on visible text, diagrams, UI, objects, and any product-relevant details.`,
    maxTokens: 1024,
    timeoutMs: 30_000,
  });
  return result.text.trim() || undefined;
}

async function extractDocumentAttachment(params: {
  note: Note;
  att: NoteAttachment;
  notesService: NoteAgentContextNotesService;
}): Promise<string | undefined> {
  const buffer = await readAttachmentBuffer(params.notesService, params.note.id, params.att);
  if (!buffer) return undefined;
  const result = extractDocumentText({ buffer, fileName: params.att.fileName, mimeType: params.att.mimeType });
  if (!result.ok) return undefined;
  return truncateText(result.text, MAX_TEXT_ATTACHMENT_CHARS).text;
}

function fallbackImageSummary(att: NoteAttachment): string {
  return `Image attachment available for native vision models: ${att.fileName} (${att.mimeType}, ${att.size} bytes). Configure an image understanding model to persist a text summary for non-vision models.`;
}

function fallbackVideoSummary(att: NoteAttachment): string {
  return `Video attachment available: ${att.fileName} (${att.mimeType}, ${att.size} bytes). Audio transcription will be included when STT accepts this media.`;
}

function unsupportedDocumentSummary(att: NoteAttachment): string {
  return `Document extraction is not available for ${att.fileName} (${att.mimeType}).`;
}

async function buildAttachmentContext(params: {
  note: Note;
  att: NoteAttachment;
  notesService: NoteAgentContextNotesService;
  config?: Config;
}): Promise<NoteAgentAttachmentContext> {
  const { note, att, notesService, config } = params;
  try {
    if (att.type === 'audio') {
      const transcript = await ensureMediaTranscript({ note, att, notesService, config });
      return transcript
        ? { attachmentId: att.id, type: att.type, fileName: att.fileName, mimeType: att.mimeType, size: att.size, status: 'ready', transcript }
        : { attachmentId: att.id, type: att.type, fileName: att.fileName, mimeType: att.mimeType, size: att.size, status: 'unsupported', summary: 'Audio transcription is not configured or produced no transcript.' };
    }
    const extractedText = await attachmentTextExcerpt(notesService, note.id, att);
    if (extractedText) {
      return { attachmentId: att.id, type: att.type, fileName: att.fileName, mimeType: att.mimeType, size: att.size, status: 'ready', extractedText };
    }
    if (att.type === 'image') {
      const summary = await describeImageAttachment({ note, att, notesService, config }).catch(() => undefined);
      return { attachmentId: att.id, type: att.type, fileName: att.fileName, mimeType: att.mimeType, size: att.size, status: summary ? 'ready' : 'unsupported', summary: summary ?? fallbackImageSummary(att) };
    }
    if (att.type === 'video') {
      const transcript = await ensureMediaTranscript({ note, att, notesService, config }).catch(() => undefined);
      return transcript
        ? { attachmentId: att.id, type: att.type, fileName: att.fileName, mimeType: att.mimeType, size: att.size, status: 'ready', transcript, summary: fallbackVideoSummary(att) }
        : { attachmentId: att.id, type: att.type, fileName: att.fileName, mimeType: att.mimeType, size: att.size, status: 'unsupported', summary: fallbackVideoSummary(att) };
    }
    if (isDocumentAttachment(att)) {
      const extractedDocumentText = await extractDocumentAttachment({ note, att, notesService }).catch(() => undefined);
      return extractedDocumentText
        ? { attachmentId: att.id, type: att.type, fileName: att.fileName, mimeType: att.mimeType, size: att.size, status: 'ready', extractedText: extractedDocumentText }
        : { attachmentId: att.id, type: att.type, fileName: att.fileName, mimeType: att.mimeType, size: att.size, status: 'unsupported', summary: unsupportedDocumentSummary(att) };
    }
    return { attachmentId: att.id, type: att.type, fileName: att.fileName, mimeType: att.mimeType, size: att.size, status: 'unsupported', summary: 'No extractor is configured for this attachment type.' };
  } catch (err) {
    return { attachmentId: att.id, type: att.type, fileName: att.fileName, mimeType: att.mimeType, size: att.size, status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

function renderAttachmentContext(att: NoteAgentAttachmentContext): string {
  const lines = [
    `### Attachment: ${att.fileName}`,
    `- id: ${att.attachmentId}`,
    `- type: ${att.type}`,
    `- mimeType: ${att.mimeType}`,
    `- size: ${att.size}`,
    `- status: ${att.status}`,
  ];
  if (att.transcript) lines.push('', 'Transcript:', truncateText(att.transcript, MAX_TEXT_ATTACHMENT_CHARS).text);
  if (att.extractedText) lines.push('', 'Extracted text:', truncateText(att.extractedText, MAX_TEXT_ATTACHMENT_CHARS).text);
  if (att.summary) lines.push('', 'Summary:', att.summary);
  if (att.error) lines.push('', 'Error:', att.error);
  return lines.join('\n');
}

async function loadNativeVisionImages(notesService: NoteAgentContextNotesService, note: Note): Promise<ImageContent[]> {
  const images: ImageContent[] = [];
  for (const att of note.attachments ?? []) {
    if (att.type !== 'image') continue;
    if (!att.mimeType.toLowerCase().startsWith('image/')) continue;
    if (att.size > MAX_NATIVE_VISION_IMAGE_BYTES) continue;
    const buffer = await readAttachmentBuffer(notesService, note.id, att);
    if (!buffer || buffer.length > MAX_NATIVE_VISION_IMAGE_BYTES) continue;
    images.push({ type: 'image', data: buffer.toString('base64'), mimeType: att.mimeType });
    if (images.length >= MAX_NATIVE_VISION_IMAGES) break;
  }
  return images;
}

export async function buildNoteAgentContextArtifact(params: {
  note: Note;
  notesService: NoteAgentContextNotesService;
  config?: Config;
  force?: boolean;
}): Promise<NoteAgentContextArtifact> {
  const { note, notesService, config, force } = params;
  if (!force) {
    const cached = getNoteAgentContextRecord<NoteAgentContextArtifact>(note.id);
    if (cached && cached.noteUpdatedAt === note.updatedAt && cached.contextVersion === String(note.updatedAt)) {
      return cached.payload;
    }
  }

  const markdown = truncateText(note.markdown.trim() || '(empty)', MAX_NOTE_MARKDOWN_CHARS);
  let truncated = markdown.truncated;
  const attachmentContexts: NoteAgentAttachmentContext[] = [];
  for (const att of note.attachments ?? []) {
    attachmentContexts.push(await buildAttachmentContext({ note, att, notesService, config }));
  }

  const blocks = [
    `# Source Note: ${note.title?.trim() || 'Untitled'}`,
    '',
    `- noteId: ${note.id}`,
    `- kind: ${note.kind}`,
    `- status: ${note.status}`,
    `- createdAt: ${formatTime(note.createdAt)}`,
    `- updatedAt: ${formatTime(note.updatedAt)}`,
    note.tags?.length ? `- tags: ${note.tags.join(', ')}` : '- tags: []',
    '',
    '## Markdown',
    markdown.text,
  ];
  if (attachmentContexts.length > 0) {
    blocks.push('', '## Attachments');
    for (const att of attachmentContexts) blocks.push('', renderAttachmentContext(att));
  }

  const finalText = truncateText(blocks.join('\n'), MAX_TOTAL_CONTEXT_CHARS);
  truncated = truncated || finalText.truncated;
  const failed = attachmentContexts.filter((att) => att.status === 'failed').length;
  const unsupported = attachmentContexts.filter((att) => att.status === 'unsupported').length;
  const artifact: NoteAgentContextArtifact = {
    noteId: note.id,
    noteUpdatedAt: note.updatedAt,
    contextVersion: String(note.updatedAt),
    generatedAt: Date.now(),
    text: finalText.text,
    attachments: attachmentContexts,
    tokenEstimate: Math.ceil(finalText.text.length / 4),
    truncated,
    status: failed > 0 ? 'failed' : unsupported > 0 ? 'partial' : 'ready',
  };
  upsertNoteAgentContextRecord({
    noteId: note.id,
    noteUpdatedAt: note.updatedAt,
    contextVersion: artifact.contextVersion,
    generatedAt: artifact.generatedAt,
    payload: artifact,
  });
  return artifact;
}

export async function buildNoteAgentContext(params: {
  note: Note;
  notesService: NoteAgentContextNotesService;
  config?: Config;
  force?: boolean;
}): Promise<AgentSourceContext> {
  const artifact = await buildNoteAgentContextArtifact(params);
  const images = await loadNativeVisionImages(params.notesService, params.note);
  return {
    kind: 'note',
    sourceId: params.note.id,
    version: artifact.contextVersion,
    title: params.note.title?.trim() || 'Untitled',
    text: artifact.text,
    ...(images.length ? { images } : {}),
    tokenEstimate: artifact.tokenEstimate,
    truncated: artifact.truncated,
  };
}

export function getCachedNoteAgentContextArtifact(noteId: string): NoteAgentContextArtifact | null {
  return getNoteAgentContextRecord<NoteAgentContextArtifact>(noteId)?.payload ?? null;
}
