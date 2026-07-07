import type { EditorCommand, EditorRuntimeState } from './editor-protocol';

export const DEFAULT_EDITOR_RUNTIME_STATE: EditorRuntimeState = {
  ready: false,
  focused: false,
  selection: { from: 0, to: 0 },
  emptySelection: true,
  canUndo: false,
  canRedo: false,
  bold: false,
  italic: false,
  headingLevel: 0,
  bulletList: false,
  taskList: false,
  blockquote: false,
  codeBlock: false,
  link: false,
  image: false,
};

export const SUPPORTED_EDITOR_COMMAND_TYPES = [
  'focus',
  'blur',
  'setHeading',
  'toggleBold',
  'toggleItalic',
  'toggleBulletList',
  'toggleTaskList',
  'toggleBlockquote',
  'toggleCodeBlock',
  'insertDivider',
  'insertAttachment',
  'insertPreparedAttachment',
  'setLink',
  'removeLink',
  'undo',
  'redo',
] as const satisfies readonly EditorCommand['type'][];

export type SupportedEditorCommandType = typeof SUPPORTED_EDITOR_COMMAND_TYPES[number];

export function isSupportedEditorCommandType(value: string): value is SupportedEditorCommandType {
  return (SUPPORTED_EDITOR_COMMAND_TYPES as readonly string[]).includes(value);
}
