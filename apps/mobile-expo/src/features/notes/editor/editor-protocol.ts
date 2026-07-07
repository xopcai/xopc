export type NoteEditorTheme = {
  background: string;
  panel: string;
  input: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  accent: string;
  accentSoft: string;
  danger: string;
};

export type NoteEditorLabels = {
  placeholder: string;
  apply: string;
  textStyle: string;
  bold: string;
  italic: string;
  heading: string;
  bulletList: string;
  image: string;
  link: string;
  ai: string;
  quote: string;
  code: string;
  divider: string;
  undo: string;
  redo: string;
  todo: string;
  linkUrlPlaceholder: string;
  removeLink: string;
  imageFromLibrary: string;
  imageCamera: string;
  imageDocument: string;
  audio: string;
};

export type EditorSelectionContext = {
  from: number;
  to: number;
  markdown: string;
  currentBlockMarkdown: string;
  beforeMarkdown: string;
  afterMarkdown: string;
};

export type EditorAttachmentPickSource = 'photos' | 'camera' | 'document';

export type EditorAttachmentPickResult = {
  /** Canonical markdown src persisted in the note. */
  src: string;
  /** Display-only browser src used by the DOM editor. */
  displaySrc?: string;
  alt?: string;
  kind: 'image' | 'document' | 'audio';
  transcript?: string;
} | null;

export type EditorCommand =
  | { id: number; type: 'focus'; position?: 'start' | 'end' | number }
  | { id: number; type: 'blur' }
  | { id: number; type: 'setHeading'; level: 1 | 2 | 3 | 4 | 0 }
  | { id: number; type: 'toggleBold' }
  | { id: number; type: 'toggleItalic' }
  | { id: number; type: 'toggleBulletList' }
  | { id: number; type: 'toggleTaskList' }
  | { id: number; type: 'toggleBlockquote' }
  | { id: number; type: 'toggleCodeBlock' }
  | { id: number; type: 'insertDivider' }
  | { id: number; type: 'insertAttachment'; source: EditorAttachmentPickSource }
  | { id: number; type: 'insertPreparedAttachment'; attachment: NonNullable<EditorAttachmentPickResult> }
  | { id: number; type: 'setLink'; title: string; url: string }
  | { id: number; type: 'removeLink' }
  | { id: number; type: 'undo' }
  | { id: number; type: 'redo' };

export type EditorCommandInput = EditorCommand extends infer Command
  ? Command extends { id: number }
    ? Omit<Command, 'id'>
    : never
  : never;

export type EditorRuntimeState = {
  ready: boolean;
  focused: boolean;
  selection: { from: number; to: number };
  emptySelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  bold: boolean;
  italic: boolean;
  headingLevel: 0 | 1 | 2 | 3 | 4;
  bulletList: boolean;
  taskList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  link: boolean;
  image: boolean;
};

export type NoteEditorMode = 'viewing' | 'editing' | 'native_modal';

export type EditorEvent =
  | { type: 'ready'; state: EditorRuntimeState }
  | { type: 'focusChanged'; focused: boolean; state: EditorRuntimeState }
  | { type: 'contentChanged'; markdown: string; reason: 'typing' | 'command' | 'flush'; state?: EditorRuntimeState }
  | { type: 'selectionChanged'; context: EditorSelectionContext; state: EditorRuntimeState }
  | { type: 'flushResult'; requestId: number; markdown: string };

export type NoteEditorHandle = {
  flushMarkdown: () => Promise<string>;
  focus: (position?: 'start' | 'end' | number) => void;
};
