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
      focusTarget: 'none',
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
    });
  });
});
