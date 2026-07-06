import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EDITOR_RUNTIME_STATE,
  SUPPORTED_EDITOR_COMMAND_TYPES,
  isSupportedEditorCommandType,
} from '../editor/editor-contract';

describe('editor contract', () => {
  it('keeps flush out of the public command protocol', () => {
    expect(SUPPORTED_EDITOR_COMMAND_TYPES).toEqual([
      'focus',
      'toggleTaskList',
      'insertAttachment',
      'setLink',
      'removeLink',
      'undo',
      'redo',
    ]);
    expect(SUPPORTED_EDITOR_COMMAND_TYPES).not.toContain('flushMarkdown');
  });

  it('guards supported command type strings', () => {
    expect(isSupportedEditorCommandType('focus')).toBe(true);
    expect(isSupportedEditorCommandType('redo')).toBe(true);
    expect(isSupportedEditorCommandType('flushMarkdown')).toBe(false);
    expect(isSupportedEditorCommandType('formatBold')).toBe(false);
  });

  it('defines the initial runtime state contract', () => {
    expect(DEFAULT_EDITOR_RUNTIME_STATE).toEqual({
      ready: false,
      focused: false,
      selection: { from: 0, to: 0 },
      canUndo: false,
      canRedo: false,
      todo: false,
      link: false,
      image: false,
    });
  });
});
