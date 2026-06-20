import { randomUUID } from 'node:crypto';

import { complete, type UserMessage } from '@earendil-works/pi-ai';

import type { Config } from '../config/schema.js';
import { getDefaultModelSync, resolveModel } from '../providers/index.js';
import { createLogger } from '../utils/logger.js';
import { buildNoteAttachmentRef } from './attachment-ref.js';
import { partitionAttachmentsByReference } from './note-attachment-sync.js';
import { parseNoteMarkdown } from './note-markdown.js';
import { buildNoteAgentContextArtifact, getCachedNoteAgentContextArtifact } from './agent-context.js';
import { NotesStore } from './store.js';
import type {
  CaptureSource,
  CreateNoteParams,
  Note,
  NoteAiPatch,
  NoteAttachment,
  NoteCatalysisAction,
  NoteCatalysisMeta,
  NoteCatalysisReport,
  NoteIndexEntry,
  NoteKind,
  NoteSnapshot,
  NoteSnapshotEntry,
  NotesListQuery,
  SnapshotTrigger,
} from './types.js';

const log = createLogger('NotesService');
const MAX_SNAPSHOTS_PER_NOTE = 50;
const SNAPSHOT_THROTTLE_MS = 60_000;

function inferKind(markdown?: string, hasAttachments?: boolean, attachments?: NoteAttachment[]): NoteKind {
  if (hasAttachments && attachments?.length && attachments.every((item) => item.type === 'audio')) return 'voice';
  if (hasAttachments) return 'media';
  if (!markdown) return 'thought';
  const lower = markdown.toLowerCase();
  if (/^(todo|task|remind|buy|call|email|meet|finish|submit|send)\b/i.test(lower) || /\b(明天|今天|记得|别忘|待办|提醒)\b/.test(markdown)) return 'todo';
  if (/^https?:\/\//.test(markdown.trim())) return 'bookmark';
  return 'thought';
}

function deriveDefaultTitle(markdown?: string): string | undefined {
  const normalized = parseNoteMarkdown(markdown ?? '').plainText.trim().replace(/\s+/g, ' ');
  return normalized ? Array.from(normalized).slice(0, 10).join('') : undefined;
}

function splitMeaningfulLines(markdown?: string): string[] {
  return parseNoteMarkdown(markdown ?? '').plainText.split(/\n|。|；|;/).map((line) => line.trim()).filter(Boolean);
}

function summarizeIdea(markdown?: string): string {
  const lines = splitMeaningfulLines(markdown);
  return lines.slice(0, 3).join('；').slice(0, 140);
}

function inferCatalysisStage(note: Note): NonNullable<NoteCatalysisMeta['stage']> {
  const text = `${note.title ?? ''}\n${note.markdown}`;
  if (/上线|发布|launch|ship/i.test(text)) return 'shipped';
  if (/验证|访谈|用户|测试|validate/i.test(text)) return 'validating';
  if (/开发|实现|构建|build|mvp/i.test(text)) return 'developing';
  if (/想法|机会|问题|idea|seed/i.test(text)) return 'seed';
  return 'incubating';
}

function buildCatalysisReport(note: Note): NoteCatalysisReport {
  const summary = summarizeIdea(note.markdown || note.title);
  const title = note.title?.trim() || summary.slice(0, 28) || '未命名想法';
  const actions: NoteCatalysisAction[] = [
    { kind: 'research', text: `验证「${title}」的真实需求和目标用户` },
    { kind: 'task', text: `拆解「${title}」的最小可行下一步` },
    { kind: 'chat', text: `继续和 AI 讨论「${title}」的方案` },
  ];
  return {
    originalNoteId: note.id,
    generatedAt: Date.now(),
    title,
    valueHypothesis: summary || '这条笔记可能包含一个待澄清的想法。',
    targetUsers: ['待确认的核心用户'],
    keyQuestions: ['用户为什么现在需要它？', '最小可验证版本是什么？', '如何判断它值得继续投入？'],
    mvpPath: ['定义目标用户', '写出最小场景', '完成一次验证'],
    risks: ['需求不够明确', '执行路径过大'],
    nextActions: actions,
    confidence: summary ? 0.58 : 0.35,
  };
}

function normalizeAiCatalysisReport(note: Note, data: Record<string, unknown>): NoteCatalysisReport {
  const fallback = buildCatalysisReport(note);
  const stringArray = (value: unknown, fallbackValue: string[]) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 12) : fallbackValue;
  const actions = Array.isArray(data.nextActions)
    ? data.nextActions.map((item): NoteCatalysisAction | null => {
      if (!item || typeof item !== 'object') return null;
      const row = item as { kind?: unknown; text?: unknown };
      const kind = row.kind === 'task' || row.kind === 'workflow' || row.kind === 'research' || row.kind === 'share' || row.kind === 'chat' ? row.kind : 'task';
      return typeof row.text === 'string' && row.text.trim() ? { kind, text: row.text.trim() } : null;
    }).filter((item): item is NoteCatalysisAction => Boolean(item)).slice(0, 12)
    : fallback.nextActions;
  return {
    originalNoteId: note.id,
    generatedAt: Date.now(),
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : fallback.title,
    valueHypothesis: typeof data.valueHypothesis === 'string' && data.valueHypothesis.trim() ? data.valueHypothesis.trim() : fallback.valueHypothesis,
    targetUsers: stringArray(data.targetUsers, fallback.targetUsers),
    keyQuestions: stringArray(data.keyQuestions, fallback.keyQuestions),
    mvpPath: stringArray(data.mvpPath, fallback.mvpPath),
    risks: stringArray(data.risks, fallback.risks),
    nextActions: actions,
    confidence: typeof data.confidence === 'number' ? Math.max(0, Math.min(1, data.confidence)) : fallback.confidence,
  };
}

function buildCatalysisPrompt(note: Note): string {
  const title = note.title?.trim() || '未命名笔记';
  const markdown = note.markdown.trim() || '(无正文)';
  return `请把下面的 Markdown 笔记催化成可执行的想法报告，输出 JSON：\n{\n  "title": string,\n  "valueHypothesis": string,\n  "targetUsers": string[],\n  "keyQuestions": string[],\n  "mvpPath": string[],\n  "risks": string[],\n  "nextActions": [{"text": string, "kind": "task"|"workflow"|"research"|"share"|"chat"}],\n  "confidence": number\n}\n\n标题：${title}\n\nMarkdown：\n${markdown}`;
}

async function buildAiCatalysisReport(note: Note, config?: Config): Promise<NoteCatalysisReport> {
  const modelRef = getDefaultModelSync(config) ?? 'openai/gpt-5.5';
  const resolved = resolveModel(modelRef);
  const messages: UserMessage[] = [{ role: 'user', content: buildCatalysisPrompt(note), timestamp: Date.now() }];
  const response = await complete(resolved, { messages }, { temperature: 0.2 });
  let responseText = '';
  if (Array.isArray(response.content)) {
    for (const part of response.content) {
      if (part && typeof part === 'object' && (part as { type?: string }).type === 'text') {
        responseText += String((part as { text?: string }).text || '');
      }
    }
  }
  const raw = responseText.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return normalizeAiCatalysisReport(note, JSON.parse(raw) as Record<string, unknown>);
}

export class NotesService {
  private lastSnapshotAt = new Map<string, number>();

  constructor(private readonly store = new NotesStore()) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  async quickCapture(markdown: string, source: CaptureSource): Promise<Note> {
    const id = randomUUID();
    const now = Date.now();
    const note: Note = {
      id,
      title: deriveDefaultTitle(markdown),
      kind: inferKind(markdown),
      status: 'inbox',
      markdown,
      createdAt: now,
      updatedAt: now,
      capturedVia: source,
      remoteVersion: 1,
      localVersion: 1,
    };
    await this.store.addNote(note);
    log.debug({ id: note.id, kind: note.kind }, 'Quick capture');
    return note;
  }

  async createNote(params: CreateNoteParams): Promise<Note> {
    const id = randomUUID();
    const now = Date.now();
    const markdown = params.markdown ?? '';
    const note: Note = {
      id,
      title: params.title ?? deriveDefaultTitle(markdown),
      kind: params.kind ?? inferKind(markdown),
      status: 'inbox',
      markdown,
      attachments: [],
      createdAt: now,
      updatedAt: now,
      capturedVia: params.capturedVia,
      tags: params.tags,
      pinned: params.pinned,
      groupId: params.groupId,
      taskMeta: params.taskMeta,
      remoteVersion: 1,
      localVersion: 1,
    };
    await this.store.addNote(note);
    log.debug({ id: note.id, kind: note.kind }, 'Note created');
    return note;
  }

  async getNote(id: string): Promise<Note | null> {
    return this.store.getNote(id);
  }

  async updateNote(id: string, patch: Partial<Note>, trigger: SnapshotTrigger = 'edit'): Promise<Note | null> {
    const existing = await this.store.getNote(id);
    if (!existing) return null;
    const contentTouched = patch.markdown !== undefined || patch.title !== undefined;
    if (contentTouched) await this.maybeSaveSnapshot(existing, trigger);

    const normalizedPatch: Partial<Note> = { ...patch };
    if (patch.markdown !== undefined) {
      normalizedPatch.kind = patch.kind ?? inferKind(patch.markdown, Boolean(existing.attachments?.length), existing.attachments);
    }
    if (contentTouched || patch.attachments) {
      normalizedPatch.remoteVersion = (existing.remoteVersion ?? 1) + 1;
      normalizedPatch.localVersion = patch.localVersion ?? (existing.localVersion ?? 1) + 1;
    }

    const updatedRaw = await this.store.updateNote(id, normalizedPatch);
    return updatedRaw ? this.reconcileAttachments(updatedRaw) : null;
  }

  private async reconcileAttachments(note: Note): Promise<Note> {
    const { kept, removed } = partitionAttachmentsByReference(note);
    if (removed.length === 0) return note;
    for (const attachment of removed) await this.store.deleteAttachmentFile(note.id, attachment.relativePath);
    log.debug({ noteId: note.id, removedIds: removed.map((attachment) => attachment.id) }, 'Pruned orphan note attachments');
    const hasAttachments = kept.length > 0;
    const updated = await this.store.updateNote(note.id, { attachments: kept, kind: inferKind(note.markdown, hasAttachments, kept) });
    return updated ?? { ...note, attachments: kept };
  }

  async syncNote(id: string, patch: Partial<Note>, baseRemoteVersion?: number): Promise<{ note: Note | null; conflict: boolean }> {
    const existing = await this.store.getNote(id);
    if (!existing) return { note: null, conflict: false };
    if (baseRemoteVersion !== undefined && existing.remoteVersion !== undefined && baseRemoteVersion < existing.remoteVersion) {
      return { note: existing, conflict: true };
    }
    const updated = await this.updateNote(id, patch, 'sync');
    return { note: updated, conflict: false };
  }

  async createAiEditPatch(id: string, instruction: string, markdownOverride?: string): Promise<{ message: string; patch: NoteAiPatch } | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;
    const source = markdownOverride ?? note.markdown;
    const parsed = parseNoteMarkdown(source, id);
    const wantsTodos = /待办|todo|task|行动|提醒/i.test(instruction);
    const wantsSummary = /摘要|总结|summary|压缩/i.test(instruction);
    let generated = '';
    if (wantsTodos) {
      const lines = source.split(/\n|。|；|;/).map((line) => line.trim()).filter(Boolean);
      generated = (lines.length ? lines : [parsed.plainText]).slice(0, 12).map((line) => `- [ ] ${line.replace(/^[-*\d.\s\[\]x]+/i, '').trim()}`).join('\n');
    } else if (wantsSummary) {
      generated = `> [!SUMMARY]\n> ${parsed.plainText.slice(0, 220)}`;
    } else {
      generated = `${source.trimEnd()}\n\n## AI 整理\n\n${instruction.trim()}`;
    }
    return {
      message: 'AI edit patch generated',
      patch: {
        id: randomUUID(),
        summary: instruction,
        operations: [{ type: 'replaceRange', from: 0, to: source.length, markdown: generated || source }],
      },
    };
  }

  async catalyzeNote(id: string, config?: Config): Promise<{ note: Note; report: NoteCatalysisReport } | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;
    let report: NoteCatalysisReport;
    try {
      report = await buildAiCatalysisReport(note, config);
    } catch (err) {
      log.warn({ err, noteId: id }, 'AI note catalysis failed; using local fallback report');
      report = buildCatalysisReport(note);
    }
    const updated = await this.updateNote(id, {
      aiDeep: {
        ...note.aiDeep,
        processedAt: Date.now(),
        catalysis: {
          status: 'catalyzed',
          stage: inferCatalysisStage(note),
          lastCatalyzedAt: Date.now(),
          confidence: report.confidence,
          report,
          ...note.aiDeep?.catalysis,
        },
      },
      ai: { ...note.ai, intent: note.ai?.intent ?? 'idea', summary: note.ai?.summary ?? report.valueHypothesis },
      status: note.status === 'inbox' ? 'processed' : note.status,
    }, 'ai_edit');
    return updated ? { note: updated, report } : null;
  }

  async recordCatalysisFeedback(id: string, feedback: 'helpful' | 'not_helpful' | 'neutral'): Promise<Note | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;
    return this.updateNote(id, { aiDeep: { ...note.aiDeep, processedAt: Date.now(), catalysis: { status: note.aiDeep?.catalysis?.status ?? 'catalyzed', ...note.aiDeep?.catalysis, feedback } } });
  }

  async linkNoteThread(id: string, sessionKey: string): Promise<Note | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;
    const existingKeys = note.aiDeep?.catalysis?.linkedSessionKeys ?? [];
    return this.updateNote(id, {
      aiDeep: {
        ...note.aiDeep,
        processedAt: Date.now(),
        catalysis: {
          status: note.aiDeep?.catalysis?.status ?? 'none',
          ...note.aiDeep?.catalysis,
          sourceSessionKey: note.aiDeep?.catalysis?.sourceSessionKey ?? sessionKey,
          linkedSessionKeys: Array.from(new Set([...existingKeys, sessionKey])),
        },
      },
    }, 'sync');
  }

  async listNoteThreads(id: string): Promise<string[] | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;
    return Array.from(new Set([note.aiDeep?.catalysis?.sourceSessionKey, ...(note.aiDeep?.catalysis?.linkedSessionKeys ?? [])].filter((key): key is string => Boolean(key))));
  }

  async getAgentContextStatus(id: string, config?: Config, force = false): Promise<{ noteUpdatedAt: number; artifact: import('./agent-context.js').NoteAgentContextArtifact | null; stale: boolean } | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;
    const cached = getCachedNoteAgentContextArtifact(id);
    if (!force && cached && cached.noteUpdatedAt === note.updatedAt) {
      return { noteUpdatedAt: note.updatedAt, artifact: cached, stale: false };
    }
    const artifact = await buildNoteAgentContextArtifact({ note, notesService: this, config, force });
    return { noteUpdatedAt: note.updatedAt, artifact, stale: false };
  }

  async appendTextToNote(id: string, content: string, heading = 'AI 讨论沉淀'): Promise<Note | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;
    const trimmed = content.trim();
    if (!trimmed) return note;
    const current = note.markdown.trimEnd();
    const nextMarkdown = `${current}${current ? '\n\n' : ''}## ${heading}\n\n${trimmed}\n`;
    return this.updateNote(id, { markdown: nextMarkdown }, 'ai_edit');
  }

  async deleteNote(id: string): Promise<boolean> {
    const removed = await this.store.deleteNote(id);
    if (removed) await this.store.deleteAllSnapshots(id);
    return removed;
  }

  async listNotes(query: NotesListQuery = {}): Promise<{ items: NoteIndexEntry[]; total: number; limit: number; offset: number; hasMore: boolean }> {
    return this.store.listNotes(query);
  }

  async addAttachment(noteId: string, file: { name: string; buffer: Buffer; mimeType: string; duration?: number }): Promise<NoteAttachment | null> {
    const note = await this.store.getNote(noteId);
    if (!note) return null;
    const { relativePath, size } = await this.store.saveAttachment(noteId, file.name, file.buffer);
    const attachment: NoteAttachment = {
      id: randomUUID(),
      type: file.mimeType.startsWith('image/') ? 'image' : file.mimeType.startsWith('audio/') ? 'audio' : file.mimeType.startsWith('video/') ? 'video' : 'file',
      mimeType: file.mimeType,
      fileName: file.name,
      size,
      relativePath,
      duration: file.duration,
    };
    const attachments = [...(note.attachments || []), attachment];
    const kind = note.kind === 'thought' && attachment.type === 'audio' ? 'voice' : note.kind === 'thought' ? 'media' : note.kind;
    await this.store.updateNote(noteId, { attachments, kind });
    return attachment;
  }

  async getAttachmentPath(noteId: string, attachmentId: string): Promise<{ filePath: string; mimeType: string; fileName: string } | null> {
    const note = await this.store.getNote(noteId);
    if (!note) return null;
    const attachment = note.attachments?.find((a) => a.id === attachmentId);
    if (!attachment) return null;
    return { filePath: this.store.resolveAttachmentPath(noteId, attachment.relativePath), mimeType: attachment.mimeType, fileName: attachment.fileName };
  }

  async listNoteHistory(noteId: string): Promise<NoteSnapshotEntry[]> { return this.store.listSnapshots(noteId); }
  async getNoteSnapshot(noteId: string, timestamp: number): Promise<NoteSnapshot | null> { return this.store.getSnapshot(noteId, timestamp); }

  async restoreNoteSnapshot(noteId: string, timestamp: number): Promise<Note | null> {
    const snapshot = await this.store.getSnapshot(noteId, timestamp);
    const existing = await this.store.getNote(noteId);
    if (!snapshot || !existing) return null;
    await this.maybeSaveSnapshot(existing, 'restore');
    this.lastSnapshotAt.set(noteId, Date.now());
    await this.store.pruneSnapshots(noteId, MAX_SNAPSHOTS_PER_NOTE);
    return this.store.updateNote(noteId, { title: snapshot.title, markdown: snapshot.markdown, tags: snapshot.tags, kind: snapshot.kind, status: snapshot.status });
  }

  async flush(): Promise<void> { await this.store.flush(); }
  async moveToGroup(noteId: string, groupId: string | null): Promise<Note | null> { return this.updateNote(noteId, { groupId: groupId ?? undefined }); }

  async createTask(title: string, source: CaptureSource, opts: { dueAt?: number; priority?: 'high' | 'medium' | 'low'; sourceSessionKey?: string; sourceNoteId?: string; groupId?: string } = {}): Promise<Note> {
    return this.createNote({
      title,
      markdown: `- [ ] ${title}`,
      kind: 'task',
      capturedVia: source,
      groupId: opts.groupId,
      taskMeta: { done: false, dueAt: opts.dueAt, priority: opts.priority, sourceSessionKey: opts.sourceSessionKey, sourceNoteId: opts.sourceNoteId },
    });
  }

  async toggleTaskDone(noteId: string): Promise<Note | null> {
    const note = await this.store.getNote(noteId);
    if (!note || note.kind !== 'task') return null;
    const done = !note.taskMeta?.done;
    const markdown = note.markdown.replace(/^- \[[ xX]\]/m, `- [${done ? 'x' : ' '}]`);
    return this.updateNote(noteId, { markdown, taskMeta: { ...note.taskMeta, done } });
  }

  async updateTaskMeta(noteId: string, patch: Partial<import('./types.js').NoteTaskMeta>): Promise<Note | null> {
    const note = await this.store.getNote(noteId);
    if (!note || note.kind !== 'task') return null;
    return this.updateNote(noteId, { taskMeta: { ...note.taskMeta, done: note.taskMeta?.done ?? false, ...patch } });
  }

  async recordOpen(noteId: string): Promise<Note | null> {
    return this.updateNote(noteId, { lastOpenedAt: Date.now() } as Partial<Note>);
  }

  private async maybeSaveSnapshot(note: Note, trigger: SnapshotTrigger): Promise<void> {
    if (trigger !== 'edit') {
      await this.store.saveSnapshot(note, trigger);
      this.lastSnapshotAt.set(note.id, Date.now());
      await this.store.pruneSnapshots(note.id, MAX_SNAPSHOTS_PER_NOTE);
      return;
    }
    const last = this.lastSnapshotAt.get(note.id) ?? 0;
    if (Date.now() - last < SNAPSHOT_THROTTLE_MS) return;
    await this.store.saveSnapshot(note, trigger);
    this.lastSnapshotAt.set(note.id, Date.now());
    await this.store.pruneSnapshots(note.id, MAX_SNAPSHOTS_PER_NOTE);
  }
}

export { buildNoteAttachmentRef };
