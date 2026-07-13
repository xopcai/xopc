import type { NoteEditorMode } from './editor-protocol';

export type NoteEditorPresentationState = 'none' | 'opening' | 'open';

export type NoteEditorInteractionState = {
  focused: boolean;
  presentation: NoteEditorPresentationState;
};

export function noteEditorModeFromInteraction({
  focused,
  presentation,
}: NoteEditorInteractionState): NoteEditorMode {
  if (presentation !== 'none') return 'native_modal';
  return focused ? 'editing' : 'viewing';
}
