export type NoteKind = 'thought' | 'todo' | 'voice' | 'media' | 'bookmark' | 'mixed';
export type NoteStatus = 'inbox' | 'processed' | 'archived' | 'trashed';
export type CaptureChannel = 'app' | 'web' | 'electron' | 'tui' | 'telegram' | 'wechat' | 'feishu';

export type NoteBlockType =
  | 'paragraph'
  | 'heading'
  | 'todo'
  | 'bulletList'
  | 'numberedList'
  | 'quote'
  | 'code'
  | 'divider'
  | 'image'
  | 'aiSuggestion';

export interface BaseNoteBlock {
  id: string;
  type: NoteBlockType;
  createdAt: number;
  updatedAt: number;
}

export interface TextNoteBlock extends BaseNoteBlock {
  type: 'paragraph' | 'heading' | 'bulletList' | 'numberedList' | 'quote' | 'code' | 'aiSuggestion';
  text: string;
  level?: 1 | 2 | 3;
  indent?: number;
}

export interface TodoNoteBlock extends BaseNoteBlock {
  type: 'todo';
  text: string;
  checked: boolean;
}

export interface DividerNoteBlock extends BaseNoteBlock {
  type: 'divider';
}

export interface ImageNoteBlock extends BaseNoteBlock {
  type: 'image';
  attachmentId: string;
  alt?: string;
  width?: number;
}

export type NoteBlock = TextNoteBlock | TodoNoteBlock | DividerNoteBlock | ImageNoteBlock;

export type NotePatchOperation =
  | { type: 'replaceBlocks'; blocks: NoteBlock[] }
  | { type: 'insertBlocksAfter'; afterBlockId: string; blocks: NoteBlock[] }
  | { type: 'updateBlock'; blockId: string; patch: Partial<NoteBlock> }
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

export interface NoteAiDeepMeta {
  processedAt: number;
  priority?: 'high' | 'medium' | 'low';
  relatedNoteIds?: string[];
  relatedGoalId?: string;
  insights?: string;
}

export interface CaptureSource {
  channel: CaptureChannel;
  platform?: 'ios' | 'android';
}

export interface Note {
  id: string;
  title?: string;
  kind: NoteKind;
  status: NoteStatus;
  text?: string;
  blocks?: NoteBlock[];
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
  /** First image attachment id for list thumbnails. */
  coverAttachmentId?: string;
  /** First audio attachment id for inline voice playback. */
  voiceAttachmentId?: string;
  /** Duration in seconds of the voice attachment (when available). */
  voiceDurationSec?: number;
  /** Lowercased attachment file names for list search. */
  attachmentNames?: string[];
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
  text?: string;
  blocks?: NoteBlock[];
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
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateNoteParams {
  title?: string;
  text?: string;
  blocks?: NoteBlock[];
  kind?: NoteKind;
  tags?: string[];
  capturedVia: CaptureSource;
  pinned?: boolean;
}
