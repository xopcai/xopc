// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { afterEach, describe, expect, it } from 'vitest';

import { CodeBlockLanguage } from '../web-editor/NoteEditorExtensions';

function createMarkdownEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: false,
        underline: false,
      }),
      CodeBlockLanguage,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        autolink: true,
        openOnClick: false,
      }),
      Markdown.configure({
        html: true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content: '',
  });
}

function editorMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? editor.getText();
}

describe('DOM note editor Markdown fidelity', () => {
  const editors: Editor[] = [];

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it.each([
    {
      name: 'headings and inline marks',
      markdown: '# Heading\n\nText with **bold**, *italic*, `code`, and [link](https://example.com).',
    },
    {
      name: 'nested bullet lists',
      markdown: '- parent\n  - child',
    },
    {
      name: 'nested task lists',
      markdown: '- [ ] open\n  - [x] done',
      expected: '- [ ] open\n\n  - [x] done',
    },
    {
      name: 'ordered lists and blockquotes',
      markdown: '1. first\n2. second\n\n> quoted text',
    },
  ])('round-trips $name', ({ markdown, expected }) => {
    const editor = createMarkdownEditor();
    editors.push(editor);
    editor.commands.setContent(markdown, { emitUpdate: false });
    expect(editorMarkdown(editor)).toBe(expected ?? markdown);
  });

  it('retains fenced-code content and records its language when supported', () => {
    const editor = createMarkdownEditor();
    editors.push(editor);
    editor.commands.setContent('```ts\nconst value = 1;\n```', { emitUpdate: false });
    const markdown = editorMarkdown(editor);
    expect(markdown).toContain('const value = 1;');
    expect(markdown).toMatch(/^```ts\n/);
  });
});
