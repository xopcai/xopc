import type { EditorCommand, EditorRuntimeState } from './editor-protocol';

export const DEFAULT_EDITOR_RUNTIME_STATE: EditorRuntimeState = {
  ready: false,
  focused: false,
  selection: { from: 0, to: 0 },
  canUndo: false,
  canRedo: false,
  todo: false,
  link: false,
  image: false,
};

export const SUPPORTED_EDITOR_COMMAND_TYPES = [
  'focus',
  'toggleTaskList',
  'insertAttachment',
  'setLink',
  'removeLink',
  'undo',
  'redo',
] as const satisfies readonly EditorCommand['type'][];

export type SupportedEditorCommandType = typeof SUPPORTED_EDITOR_COMMAND_TYPES[number];

export function isSupportedEditorCommandType(value: string): value is SupportedEditorCommandType {
  return (SUPPORTED_EDITOR_COMMAND_TYPES as readonly string[]).includes(value);
}
