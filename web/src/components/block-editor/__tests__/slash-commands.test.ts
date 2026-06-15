// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { NodeSelection } from '@tiptap/pm/state';

import { slashCommandsPluginKey, SlashCommands } from '../extensions/slash-commands';
import { BlockTrailingNode } from '../extensions/trailing-node';
import { focusAfterBlockInsert, setTextSelectionAfterBlock } from '../extensions/block-insert-focus';
import { filterSlashItems, runSlashItem } from '../slash-items';

describe('filterSlashItems', () => {
  it('returns all items for an empty query', () => {
    expect(filterSlashItems('')).toHaveLength(10);
  });

  it('filters by label and keywords', () => {
    expect(filterSlashItems('photo').map((item) => item.id)).toEqual(['image']);
    expect(filterSlashItems('h1').map((item) => item.id)).toEqual(['heading1']);
  });
});

describe('setTextSelectionAfterBlock', () => {
  it('moves node selection on an image into the trailing paragraph', () => {
    const editor = new Editor({
      extensions: [StarterKit, BlockTrailingNode, Image],
      content: '<p>Hello</p><img src="https://example.com/a.png" alt="a" />',
    });

    try {
      let imagePos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image') {
          imagePos = pos;
          return false;
        }
        return undefined;
      });
      expect(imagePos).toBeGreaterThan(-1);

      editor.commands.setNodeSelection(imagePos);
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);

      editor.commands.command(({ tr, dispatch }) => {
        if (dispatch) {
          setTextSelectionAfterBlock(tr);
        }
        return true;
      });

      const { $from } = editor.state.selection;
      expect($from.parent.type.name).toBe('paragraph');
      expect($from.parent.content.size).toBe(0);
    } finally {
      editor.destroy();
    }
  });
});

describe('focusAfterBlockInsert', () => {
  it('places the cursor in a textblock after inserting a horizontal rule', () => {
    const editor = new Editor({
      extensions: [StarterKit, BlockTrailingNode],
      content: '<p>Hello</p>',
    });

    try {
      editor.chain().focus('end').setHorizontalRule().run();
      focusAfterBlockInsert(editor);

      const { $from } = editor.state.selection;
      expect($from.parent.type.name).toBe('paragraph');
    } finally {
      editor.destroy();
    }
  });
});

describe('SlashCommands extension', () => {
  it('activates the suggestion plugin and renders the menu in a mounted editor', async () => {
    const element = document.createElement('div');
    document.body.appendChild(element);

    const editor = new Editor({
      element,
      extensions: [StarterKit, BlockTrailingNode, SlashCommands.configure({ getRuntime: () => ({}) })],
      content: '<p></p>',
    });

    try {
      editor.commands.focus('end');
      editor.commands.insertContent('/');

      await vi.waitUntil(
        () => slashCommandsPluginKey.getState(editor.state)?.active === true,
        { timeout: 1000 },
      );

      await vi.waitUntil(
        () => document.querySelector('.slash-menu-panel'),
        { timeout: 2000 },
      );

      expect(editor.storage.slashCommands.active).toBe(true);
      expect(document.querySelector('[data-slash-menu-root]')).not.toBeNull();
    } finally {
      editor.destroy();
      element.remove();
      document.querySelector('[data-slash-menu-root]')?.remove();
    }
  });
});

describe('runSlashItem', () => {
  it('converts slash selection into a heading', () => {
    const editor = new Editor({
      extensions: [StarterKit, BlockTrailingNode],
      content: '<p>/heading</p>',
    });

    try {
      const range = { from: 1, to: 9 };
      runSlashItem(
        { id: 'heading1', label: 'Heading 1', description: '', keywords: [] },
        editor,
        range,
        {},
      );

      expect(editor.getHTML()).toContain('<h1>');
      expect(editor.getHTML()).not.toContain('/heading');
    } finally {
      editor.destroy();
    }
  });
});
