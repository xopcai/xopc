import { randomUUID } from 'node:crypto';

import { complete, type UserMessage } from '@earendil-works/pi-ai';

import type { Config } from '../config/schema.js';
import { getDefaultModelSync, resolveModel } from '../providers/index.js';
import { createLogger } from '../utils/logger.js';
import { buildNoteAttachmentRef, attachmentIdFromTarget } from './attachment-ref.js';
import { partitionAttachmentsByReference } from './note-attachment-sync.js';
import { NotesStore } from './store.js';
import type {
  CaptureSource,
  CreateNoteParams,
  Note,
  NoteAiPatch,
  NoteAttachment,
  NoteBlock,
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

function inferKind(
  text?: string,
  hasAttachments?: boolean,
  attachments?: NoteAttachment[],
): NoteKind {
  if (hasAttachments && attachments?.length && attachments.every((item) => item.type === 'audio')) {
    return 'voice';
  }
  if (hasAttachments) return 'media';
  if (!text) return 'thought';
  const lower = text.toLowerCase();
  if (/^(todo|task|remind|buy|call|email|meet|finish|submit|send)\b/i.test(lower) ||
      /\b(明天|今天|记得|别忘|待办|提醒)\b/.test(text)) {
    return 'todo';
  }
  if (/^https?:\/\//.test(text.trim())) return 'bookmark';
  return 'thought';
}

function deriveDefaultTitle(text?: string): string | undefined {
  const normalizedText = text?.trim().replace(/\s+/g, ' ');
  if (!normalizedText) return undefined;
  return Array.from(normalizedText).slice(0, 10).join('');
}

function createBlockId(): string {
  return `block_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

const IMAGE_MARKDOWN = /^!\[([^\]]*)\]\(([^)]+)\)$/;

function noteTextToBlocks(text?: string, noteId?: string): NoteBlock[] | undefined {
  if (!text?.trim()) return undefined;
  const now = Date.now();
  return text.split(/\n{2,}/).map((part) => {
    const trimmed = part.trim();
    if (noteId) {
      const imageMatch = trimmed.match(IMAGE_MARKDOWN);
      if (imageMatch) {
        const attachmentId = attachmentIdFromTarget(imageMatch[2], noteId);
        if (attachmentId) {
          return {
            id: createBlockId(),
            type: 'image' as const,
            attachmentId,
            alt: imageMatch[1] || undefined,
            createdAt: now,
            updatedAt: now,
          };
        }
      }
    }
    return {
      id: createBlockId(),
      type: 'paragraph' as const,
      text: trimmed,
      createdAt: now,
      updatedAt: now,
    };
  });
}

function blocksToPlainText(blocks?: NoteBlock[], noteId?: string): string | undefined {
  if (!blocks?.length) return undefined;
  return blocks
    .map((block) => {
      if (block.type === 'divider') return '---';
      if (block.type === 'todo') return `${block.checked ? '[x]' : '[ ]'} ${block.text}`;
      if (block.type === 'image') {
        if (noteId) {
          return `![${block.alt ?? ''}](${buildNoteAttachmentRef(noteId, block.attachmentId)})`;
        }
        return block.alt ?? '';
      }
      return block.text;
    })
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}

function createAiOrganizedBlocks(blocks: NoteBlock[], instruction: string): NoteBlock[] {
  const now = Date.now();
  const plainText = blocksToPlainText(blocks) || '';
  const lines = plainText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const wantsTodos = /待办|todo|task|行动|提醒/i.test(instruction);
  const wantsSummary = /摘要|总结|summary|压缩/i.test(instruction);

  if (wantsTodos) {
    const candidates = lines.filter((line) => /要|需|记得|todo|task|完成|提交|联系|跟进|提醒/i.test(line));
    return (candidates.length ? candidates : lines).slice(0, 12).map((line) => ({
      id: createBlockId(),
      type: 'todo' as const,
      text: line.replace(/^[-*\d.\s\[\]x]+/i, '').trim(),
      checked: false,
      createdAt: now,
      updatedAt: now,
    }));
  }

  if (wantsSummary) {
    const summary = lines.join(' ').slice(0, 220);
    return [{
      id: createBlockId(),
      type: 'paragraph',
      text: summary,
      createdAt: now,
      updatedAt: now,
    }];
  }

  const titleText = lines[0]?.slice(0, 40) || '整理后的笔记';
  const bodyLines = lines.slice(1).length ? lines.slice(1) : lines;
  return [
    {
      id: createBlockId(),
      type: 'heading',
      text: titleText,
      level: 2,
      createdAt: now,
      updatedAt: now,
    },
    ...bodyLines.map((line) => ({
      id: createBlockId(),
      type: 'bulletList' as const,
      text: line.replace(/^[-*\d.\s]+/, '').trim(),
      indent: 0,
      createdAt: now,
      updatedAt: now,
    })),
  ];
}

function splitMeaningfulLines(text?: string): string[] {
  return (text ?? '')
    .split(/[\n。！？!?；;]+/)
    .map((line) => line.trim().replace(/^[-*\d.\s]+/, ''))
    .filter((line) => line.length > 0);
}

function summarizeIdea(text?: string): string {
  const lines = splitMeaningfulLines(text);
  const joined = lines.join(' ');
  return Array.from(joined || '这个想法').slice(0, 90).join('');
}

function inferCatalysisStage(note: Note): NonNullable<NoteCatalysisMeta['stage']> {
  const text = `${note.title ?? ''}\n${note.text ?? ''}`;
  if (/发布|上线|分享|推广|launch|ship/i.test(text)) return 'shipped';
  if (/验证|实验|用户|指标|反馈|validate|experiment/i.test(text)) return 'validating';
  if (/实现|开发|MVP|原型|prototype|build/i.test(text)) return 'developing';
  if (text.trim().length > 80) return 'incubating';
  return 'seed';
}

function buildCatalysisReport(note: Note): NoteCatalysisReport {
  const generatedAt = Date.now();
  const summary = summarizeIdea(note.text ?? note.title);
  const title = note.title?.trim() || summary.slice(0, 28) || '未命名想法';
  const hasUserSignal = /用户|客户|读者|创作者|团队|个人|开发者|founder|creator|user/i.test(summary);
  const hasProductSignal = /产品|工具|平台|workflow|agent|AI|自动|系统|应用/i.test(summary);
  const confidence = Math.min(0.86, Math.max(0.42, 0.48 + (hasUserSignal ? 0.16 : 0) + (hasProductSignal ? 0.18 : 0) + Math.min(summary.length, 120) / 600));

  return {
    originalNoteId: note.id,
    generatedAt,
    title,
    valueHypothesis: `如果把「${summary}」推进成一个可体验的小成果，它最可能的价值是帮助用户更快完成判断、表达或行动。`,
    targetUsers: hasUserSignal ? ['笔记作者自己', '有类似场景的目标用户'] : ['笔记作者自己', '未来可能被这个想法帮助的人'],
    keyQuestions: [
      '这个想法最想解决的具体痛点是什么？',
      '第一个可验证的用户场景是什么？',
      '什么样的最小成果能证明它值得继续投入？',
    ],
    mvpPath: [
      '把想法改写成一句清晰的问题陈述。',
      '列出 1 个目标用户和 1 个高频使用场景。',
      '产出一个最小原型、提纲或行动清单。',
    ],
    risks: [
      '想法还停留在概念层，缺少明确使用场景。',
      '下一步过大时容易变成长期搁置的项目。',
    ],
    nextActions: [
      { kind: 'chat', text: '和 AI 继续深聊这个想法，收敛成问题陈述。' },
      { kind: 'research', text: '补充 3 个相似产品、案例或用户反馈。' },
      { kind: 'task', text: '写下今天能完成的一个最小推进动作。' },
    ],
    confidence: Number(confidence.toFixed(2)),
  };
}

function stripJsonCodeFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null;
  const text = stripJsonCodeFence(raw);
  try {
    const data = JSON.parse(text) as unknown;
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const data = JSON.parse(text.slice(start, end + 1)) as unknown;
      return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function extractAssistantText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return '';
  return result.content
    .filter((block): block is { type: string; text: string } => {
      return !!block && typeof block === 'object' && (block as { type?: string }).type === 'text';
    })
    .map((block) => block.text)
    .join('')
    .trim();
}

function stringArray(value: unknown, fallback: string[], limit: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
    .slice(0, limit);
  return items.length ? items : fallback;
}

function catalysisActions(value: unknown, fallback: NoteCatalysisAction[]): NoteCatalysisAction[] {
  if (!Array.isArray(value)) return fallback;
  const allowed = new Set<NoteCatalysisAction['kind']>(['task', 'workflow', 'research', 'share', 'chat']);
  const items: NoteCatalysisAction[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { kind?: unknown; text?: unknown };
    const kind = typeof row.kind === 'string' && allowed.has(row.kind as NoteCatalysisAction['kind'])
      ? row.kind as NoteCatalysisAction['kind']
      : 'task';
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (text) items.push({ kind, text });
  }
  return items.length ? items.slice(0, 5) : fallback;
}

function normalizeAiCatalysisReport(note: Note, data: Record<string, unknown>): NoteCatalysisReport {
  const fallback = buildCatalysisReport(note);
  const confidenceRaw = typeof data.confidence === 'number' ? data.confidence : fallback.confidence;
  const confidence = Math.min(1, Math.max(0, confidenceRaw));
  return {
    originalNoteId: note.id,
    generatedAt: Date.now(),
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 80) : fallback.title,
    valueHypothesis: typeof data.valueHypothesis === 'string' && data.valueHypothesis.trim()
      ? data.valueHypothesis.trim()
      : fallback.valueHypothesis,
    targetUsers: stringArray(data.targetUsers, fallback.targetUsers, 5),
    keyQuestions: stringArray(data.keyQuestions, fallback.keyQuestions, 6),
    mvpPath: stringArray(data.mvpPath, fallback.mvpPath, 6),
    risks: stringArray(data.risks, fallback.risks, 5),
    nextActions: catalysisActions(data.nextActions, fallback.nextActions),
    confidence: Number(confidence.toFixed(2)),
  };
}

function buildCatalysisPrompt(note: Note): string {
  const title = note.title?.trim() || '未命名笔记';
  const text = (note.text ?? '').trim() || '(无正文)';
  return `你是一个帮助用户把想法推进成成果的个人 AI Agent。请基于这条 Note 做“想法催化”，帮助用户进入：想法 → 创造 → 分享 → 反馈 的循环。\n\n要求：\n- 使用自然、具体的中文。\n- 不要空泛鼓励，要给出可执行路径。\n- 输出必须是单个 JSON 对象，不要 Markdown，不要代码块。\n- 字段必须包含：title, valueHypothesis, targetUsers, keyQuestions, mvpPath, risks, nextActions, confidence。\n- nextActions 每项格式为 {"kind":"task|workflow|research|share|chat","text":"..."}。\n- confidence 是 0 到 1 的数字。\n\nNote 标题：${title}\n\nNote 正文：\n${text.slice(0, 6000)}`;
}

async function buildAiCatalysisReport(note: Note, config?: Config): Promise<NoteCatalysisReport> {
  const model = resolveModel(getDefaultModelSync(config));
  const user: UserMessage = {
    role: 'user',
    content: buildCatalysisPrompt(note),
    timestamp: Date.now(),
  };
  const result = await complete(
    model,
    { messages: [user] },
    { maxTokens: 1800, temperature: 0.2 },
  );
  const text = extractAssistantText(result);
  const data = extractJsonObject(text);
  if (!data) {
    throw new Error('Catalysis model did not return valid JSON');
  }
  return normalizeAiCatalysisReport(note, data);
}

const SNAPSHOT_THROTTLE_MS = 60_000;
const MAX_SNAPSHOTS_PER_NOTE = 30;

export class NotesService {
  private store: NotesStore;
  private lastSnapshotAt = new Map<string, number>();

  constructor(store: NotesStore) {
    this.store = store;
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    log.debug('NotesService initialized');
  }

  async quickCapture(text: string, source: CaptureSource): Promise<Note> {
    const now = Date.now();
    const id = randomUUID();
    const blocks = noteTextToBlocks(text, id);
    const note: Note = {
      id,
      title: deriveDefaultTitle(text),
      kind: inferKind(text),
      status: 'inbox',
      text,
      blocks,
      createdAt: now,
      updatedAt: now,
      capturedVia: source,
      localVersion: 0,
      remoteVersion: 1,
    };
    await this.store.addNote(note);
    log.debug({ id: note.id, kind: note.kind }, 'Quick capture');
    return note;
  }

  async createNote(params: CreateNoteParams): Promise<Note> {
    const now = Date.now();
    const id = randomUUID();
    const blocks = params.blocks ?? noteTextToBlocks(params.text, id);
    const text = params.text ?? blocksToPlainText(blocks, id);
    const note: Note = {
      id,
      title: params.title,
      kind: params.kind || inferKind(text),
      status: 'inbox',
      text,
      blocks,
      createdAt: now,
      updatedAt: now,
      capturedVia: params.capturedVia,
      tags: params.tags,
      pinned: params.pinned,
      localVersion: 0,
      remoteVersion: 1,
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

    const contentTouched = patch.text !== undefined || patch.blocks !== undefined || patch.title !== undefined;
    if (contentTouched) {
      await this.maybeSaveSnapshot(existing, trigger);
    }

    const normalizedPatch: Partial<Note> = { ...patch };
    if (patch.blocks) {
      normalizedPatch.text = patch.text ?? blocksToPlainText(patch.blocks, existing.id);
    } else if (typeof patch.text === 'string') {
      normalizedPatch.blocks = patch.blocks ?? noteTextToBlocks(patch.text, existing.id);
    }
    normalizedPatch.remoteVersion = (existing.remoteVersion ?? 0) + 1;

    if (contentTouched) {
      const merged: Note = {
        ...existing,
        ...normalizedPatch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      };
      const reconciled = await this.reconcileAttachments(merged);
      normalizedPatch.attachments = reconciled.attachments;
      normalizedPatch.kind = reconciled.kind;
    }

    return this.store.updateNote(id, normalizedPatch);
  }

  private async reconcileAttachments(note: Note): Promise<Note> {
    const { kept, removed } = partitionAttachmentsByReference(note);
    if (removed.length === 0) return note;

    for (const attachment of removed) {
      await this.store.deleteAttachmentFile(note.id, attachment.relativePath);
    }

    log.debug(
      { noteId: note.id, removedIds: removed.map((attachment) => attachment.id) },
      'Pruned orphan note attachments',
    );

    const hasAttachments = kept.length > 0;
    return {
      ...note,
      attachments: hasAttachments ? kept : undefined,
      kind: inferKind(note.text, hasAttachments, kept),
    };
  }

  async syncNote(
    id: string,
    patch: Partial<Note>,
    baseRemoteVersion?: number,
  ): Promise<{ note: Note | null; conflict: boolean }> {
    const existing = await this.store.getNote(id);
    if (!existing) return { note: null, conflict: false };

    const currentRemoteVersion = existing.remoteVersion ?? 0;
    if (baseRemoteVersion !== undefined && baseRemoteVersion < currentRemoteVersion) {
      return { note: existing, conflict: true };
    }

    const updated = await this.updateNote(id, patch, 'sync');
    return { note: updated, conflict: false };
  }

  async createAiEditPatch(
    id: string,
    instruction: string,
    blocks?: NoteBlock[],
  ): Promise<{ message: string; patch: NoteAiPatch } | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;

    const sourceBlocks = blocks?.length ? blocks : note.blocks ?? noteTextToBlocks(note.text, note.id) ?? [];
    const organizedBlocks = createAiOrganizedBlocks(sourceBlocks, instruction);
    const patch: NoteAiPatch = {
      id: randomUUID(),
      summary: `已根据「${instruction.slice(0, 40)}」生成可预览的块级整理建议`,
      operations: [{ type: 'replaceBlocks', blocks: organizedBlocks }],
    };

    return {
      message: 'AI edit patch generated',
      patch,
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

    const existingDeep = note.aiDeep;
    const catalysis: NoteCatalysisMeta = {
      ...existingDeep?.catalysis,
      status: 'catalyzed',
      stage: inferCatalysisStage(note),
      lastCatalyzedAt: report.generatedAt,
      confidence: report.confidence,
      report,
    };

    const updated = await this.updateNote(id, {
      ai: {
        ...note.ai,
        intent: note.ai?.intent ?? 'idea',
        summary: note.ai?.summary ?? report.valueHypothesis,
      },
      aiDeep: {
        ...existingDeep,
        processedAt: report.generatedAt,
        insights: report.valueHypothesis,
        catalysis,
      },
      status: note.status === 'inbox' ? 'processed' : note.status,
    }, 'ai_edit');

    return updated ? { note: updated, report } : null;
  }

  async recordCatalysisFeedback(
    id: string,
    feedback: NonNullable<NoteCatalysisMeta['feedback']>,
  ): Promise<Note | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;
    const now = Date.now();
    return this.updateNote(id, {
      aiDeep: {
        ...note.aiDeep,
        processedAt: now,
        catalysis: {
          status: note.aiDeep?.catalysis?.status ?? 'catalyzed',
          ...note.aiDeep?.catalysis,
          feedback,
        },
      },
    }, 'ai_edit');
  }

  async linkNoteThread(id: string, sessionKey: string): Promise<Note | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;
    const existingKeys = note.aiDeep?.catalysis?.linkedSessionKeys ?? [];
    const linkedSessionKeys = Array.from(new Set([sessionKey, ...existingKeys]));
    return this.updateNote(id, {
      aiDeep: {
        ...note.aiDeep,
        processedAt: Date.now(),
        catalysis: {
          status: note.aiDeep?.catalysis?.status ?? 'none',
          ...note.aiDeep?.catalysis,
          sourceSessionKey: note.aiDeep?.catalysis?.sourceSessionKey ?? sessionKey,
          linkedSessionKeys,
        },
      },
    }, 'sync');
  }

  async listNoteThreads(id: string): Promise<string[] | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;
    const keys = [
      note.aiDeep?.catalysis?.sourceSessionKey,
      ...(note.aiDeep?.catalysis?.linkedSessionKeys ?? []),
    ].filter((key): key is string => typeof key === 'string' && key.length > 0);
    return Array.from(new Set(keys));
  }

  async appendTextToNote(id: string, content: string, heading = 'AI 讨论沉淀'): Promise<Note | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;
    const trimmed = content.trim();
    if (!trimmed) return note;
    const currentText = note.text?.trimEnd() ?? '';
    const nextText = `${currentText}${currentText ? '\n\n' : ''}## ${heading}\n\n${trimmed}`;
    return this.updateNote(id, { text: nextText }, 'ai_edit');
  }

  async deleteNote(id: string): Promise<boolean> {
    const deleted = await this.store.deleteNote(id);
    if (deleted) {
      await this.store.deleteAllSnapshots(id);
      this.lastSnapshotAt.delete(id);
    }
    return deleted;
  }

  async listNotes(query: NotesListQuery = {}): Promise<{ items: NoteIndexEntry[]; total: number; limit: number; offset: number; hasMore: boolean }> {
    return this.store.listNotes(query);
  }

  async addAttachment(
    noteId: string,
    file: { name: string; buffer: Buffer; mimeType: string; duration?: number },
  ): Promise<NoteAttachment | null> {
    const note = await this.store.getNote(noteId);
    if (!note) return null;

    const { relativePath, size } = await this.store.saveAttachment(noteId, file.name, file.buffer);

    const attachment: NoteAttachment = {
      id: randomUUID(),
      type: inferAttachmentType(file.mimeType),
      mimeType: file.mimeType,
      fileName: file.name,
      size,
      relativePath,
      duration: file.duration,
    };

    const attachments = [...(note.attachments || []), attachment];
    const kind: NoteKind =
      note.kind === 'thought' && attachment.type === 'audio'
        ? 'voice'
        : note.kind === 'thought'
          ? 'media'
          : note.kind;
    await this.store.updateNote(noteId, { attachments, kind });

    return attachment;
  }

  async getAttachmentPath(
    noteId: string,
    attachmentId: string,
  ): Promise<{ filePath: string; mimeType: string; fileName: string } | null> {
    const note = await this.store.getNote(noteId);
    if (!note) return null;

    const attachment = note.attachments?.find((a) => a.id === attachmentId);
    if (!attachment) return null;

    const fullPath = this.store.resolveAttachmentPath(noteId, attachment.relativePath);
    return { filePath: fullPath, mimeType: attachment.mimeType, fileName: attachment.fileName };
  }

  async listNoteHistory(noteId: string): Promise<NoteSnapshotEntry[]> {
    return this.store.listSnapshots(noteId);
  }

  async getNoteSnapshot(noteId: string, timestamp: number): Promise<NoteSnapshot | null> {
    return this.store.getSnapshot(noteId, timestamp);
  }

  async restoreNoteSnapshot(noteId: string, timestamp: number): Promise<Note | null> {
    const snapshot = await this.store.getSnapshot(noteId, timestamp);
    if (!snapshot) return null;
    const existing = await this.store.getNote(noteId);
    if (!existing) return null;

    await this.store.saveSnapshot(existing, 'restore');
    this.lastSnapshotAt.set(noteId, Date.now());
    await this.store.pruneSnapshots(noteId, MAX_SNAPSHOTS_PER_NOTE);

    return this.store.updateNote(noteId, {
      title: snapshot.title,
      text: snapshot.text,
      blocks: snapshot.blocks,
      tags: snapshot.tags,
    });
  }

  async flush(): Promise<void> {
    await this.store.flush();
  }

  // ── Space grouping ──────────────────────────────────────────────────

  async moveToGroup(noteId: string, groupId: string | null): Promise<Note | null> {
    return this.updateNote(noteId, { groupId: groupId ?? undefined });
  }

  // ── Task lifecycle ──────────────────────────────────────────────────

  async createTask(
    title: string,
    source: CaptureSource,
    options?: { dueAt?: number; priority?: 'high' | 'medium' | 'low'; sourceSessionKey?: string; sourceNoteId?: string; groupId?: string },
  ): Promise<Note> {
    return this.createNote({
      title,
      kind: 'task',
      capturedVia: source,
      groupId: options?.groupId,
      taskMeta: {
        done: false,
        dueAt: options?.dueAt,
        priority: options?.priority,
        sourceSessionKey: options?.sourceSessionKey,
        sourceNoteId: options?.sourceNoteId,
      },
    });
  }

  async toggleTaskDone(noteId: string): Promise<Note | null> {
    const note = await this.store.getNote(noteId);
    if (!note || note.kind !== 'task') return null;
    const done = !note.taskMeta?.done;
    return this.updateNote(noteId, {
      taskMeta: { ...note.taskMeta, done },
      status: done ? 'archived' : 'processed',
    });
  }

  async updateTaskMeta(noteId: string, patch: Partial<import('./types.js').NoteTaskMeta>): Promise<Note | null> {
    const note = await this.store.getNote(noteId);
    if (!note || note.kind !== 'task') return null;
    return this.updateNote(noteId, {
      taskMeta: { ...note.taskMeta, done: note.taskMeta?.done ?? false, ...patch },
    });
  }

  // ── Open tracking ──────────────────────────────────────────────────

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

function inferAttachmentType(mimeType: string): NoteAttachment['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}
