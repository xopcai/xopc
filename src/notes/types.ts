export type NoteKind = 'thought' | 'todo' | 'voice' | 'media' | 'bookmark' | 'mixed' | 'task';
export type NoteStatus = 'inbox' | 'processed' | 'archived' | 'trashed';
export type CaptureChannel = 'app' | 'web' | 'electron' | 'tui' | 'telegram' | 'wechat' | 'feishu';

export type NotePatchOperation =
  | { type: 'replaceRange'; from: number; to: number; markdown: string }
  | { type: 'insertAt'; offset: number; markdown: string }
  | { type: 'replaceSection'; sectionId: string; markdown: string }
  | { type: 'appendSection'; heading: string; markdown: string }
  | { type: 'prependSection'; heading: string; markdown: string }
  | { type: 'updateFrontmatter'; patch: Record<string, unknown> }
  | { type: 'updateMetadata'; title?: string; tags?: string[]; status?: NoteStatus };

export interface NoteAiPatch {
  id: string;
  summary: string;
  operations: NotePatchOperation[];
}

export interface NoteAttachment {
  id: string;
  type: 'image' | 'video' | 'audio' | 'file';
  mimeType: string;
  fileName: string;
  size: number;
  relativePath: string;
  transcript?: string;
  duration?: number;
}

export interface NoteAiMeta {
  summary?: string;
  intent?: 'action_item' | 'idea' | 'reference' | 'question' | 'log';
  extractedTodos?: Array<{ text: string; deadline?: string; done: boolean }>;
  suggestedTags?: string[];
}

export interface NoteCatalysisAction {
  text: string;
  kind: 'task' | 'workflow' | 'research' | 'share' | 'chat';
}

export interface NoteCatalysisReport {
  originalNoteId: string;
  generatedAt: number;
  title: string;
  valueHypothesis: string;
  targetUsers: string[];
  keyQuestions: string[];
  mvpPath: string[];
  risks: string[];
  nextActions: NoteCatalysisAction[];
  confidence: number;
}

export interface NoteCatalysisMeta {
  status: 'none' | 'queued' | 'catalyzed' | 'snoozed' | 'dismissed';
  stage?: 'seed' | 'incubating' | 'developing' | 'validating' | 'shipped';
  lastCatalyzedAt?: number;
  nextCatalyzeAt?: number;
  feedback?: 'helpful' | 'not_helpful' | 'neutral';
  confidence?: number;
  report?: NoteCatalysisReport;
  reportNoteId?: string;
  sourceSessionKey?: string;
  linkedSessionKeys?: string[];
  linkedWorkflowRunIds?: string[];
  linkedShareIds?: string[];
}

export interface NoteAiDeepMeta {
  processedAt: number;
  priority?: 'high' | 'medium' | 'low';
  relatedNoteIds?: string[];
  relatedGoalId?: string;
  insights?: string;
  catalysis?: NoteCatalysisMeta;
}

export interface CaptureSource {
  channel: CaptureChannel;
  platform?: 'ios' | 'android';
}

export interface NoteTaskMeta {
  done: boolean;
  dueAt?: number;
  priority?: 'high' | 'medium' | 'low';
  sourceSessionKey?: string;
  sourceNoteId?: string;
}

export interface Note {
  id: string;
  title?: string;
  kind: NoteKind;
  status: NoteStatus;
  /** Canonical note body. Markdown is the only content truth. */
  markdown: string;
  attachments?: NoteAttachment[];
  createdAt: number;
  updatedAt: number;
  capturedVia: CaptureSource;
  ai?: NoteAiMeta;
  aiDeep?: NoteAiDeepMeta;
  tags?: string[];
  pinned?: boolean;
  localVersion?: number;
  remoteVersion?: number;
  groupId?: string;
  lastOpenedAt?: number;
  taskMeta?: NoteTaskMeta;
}

export interface NoteIndexEntry {
  id: string;
  title?: string;
  kind: NoteKind;
  status: NoteStatus;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  tags?: string[];
  snippet?: string;
  coverAttachmentId?: string;
  voiceAttachmentId?: string;
  voiceDurationSec?: number;
  attachmentNames?: string[];
  groupId?: string;
  lastOpenedAt?: number;
  taskDone?: boolean;
  taskDueAt?: number;
  headingCount?: number;
  taskCount?: number;
  uncheckedTaskCount?: number;
  linkCount?: number;
}

export interface NotesIndexFile {
  version: number;
  notes: NoteIndexEntry[];
}

export type SnapshotTrigger = 'edit' | 'ai_edit' | 'sync' | 'restore';

export interface NoteSnapshot {
  noteId: string;
  timestamp: number;
  trigger: SnapshotTrigger;
  title?: string;
  markdown: string;
  tags?: string[];
  kind: NoteKind;
  status: NoteStatus;
}

export interface NoteSnapshotEntry {
  timestamp: number;
  trigger: SnapshotTrigger;
  snippet?: string;
}

export interface NotesListQuery {
  status?: NoteStatus;
  kind?: NoteKind;
  tag?: string;
  pinned?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'lastOpenedAt';
  sortOrder?: 'asc' | 'desc';
  groupId?: string;
  pendingTasksOnly?: boolean;
}

export interface CreateNoteParams {
  title?: string;
  markdown?: string;
  kind?: NoteKind;
  tags?: string[];
  capturedVia: CaptureSource;
  pinned?: boolean;
  groupId?: string;
  taskMeta?: NoteTaskMeta;
}

export interface NoteGroup {
  id: string;
  name: string;
  icon?: string;
  createdAt: number;
  updatedAt: number;
}
