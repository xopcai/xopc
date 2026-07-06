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
  image: string;
  link: string;
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
  | { id: number; type: 'toggleTaskList' }
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
  canUndo: boolean;
  canRedo: boolean;
  todo: boolean;
  link: boolean;
  image: boolean;
};

export type NoteEditorHandle = {
  flushMarkdown: () => Promise<string>;
};
