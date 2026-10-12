// @vitest-environment jsdom
import fixtures from '../../../../../packages/markdown-math/fixtures/dialect-v1.json';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

import { MarkdownView } from '../markdown-view';
import { ChatMarkdownRenderer } from '@/features/chat/rendering/markdown/chat-markdown-renderer';
import { createChatBlockParser, parseChatMarkdownBlocks } from '@/features/chat/rendering/markdown/chat-math-blocks';
import { BlockMath, InlineMath } from '@/components/block-editor/extensions/math-node';
import { serializeNoteMarkdown, NOTE_MARKDOWN_OPTIONS } from '@xopcai/note-editor-core';

const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach(dispose => act(dispose)));
const raw = String.raw`\[\mathcal{R}_{syn}(s_T;g)\triangleq\mathbb{I}\big[V_g(s_T)=\mathrm{True}\big]\]`;
function render(chat: boolean, content: string, streaming = false) {
  const element = document.createElement('div'); document.body.appendChild(element);
  const root = createRoot(element); const Component = chat ? ChatMarkdownRenderer : MarkdownView;
  const update = (text: string, live: boolean) => act(() => root.render(<MemoryRouter><Component content={text} streaming={live} /></MemoryRouter>));
  update(content, streaming);
  disposers.push(() => { root.unmount(); element.remove(); });
  return { element, update };
}

describe('math rendering integration', () => {
  it.each(fixtures)('matches fixture $id in both Web renderers', ({markdown, mathCount}) => {
    for (const chat of [false,true]) {
      const {element} = render(chat, markdown);
      expect(element.querySelectorAll('.katex').length).toBe(mathCount);
      if (markdown.startsWith('![')) expect(element.querySelector('img')?.alt).toBe('$x$');
    }
  });
  it('bounds a streaming message containing formulas in separate blocks', () => {
    const {element} = render(true, Array.from({length:260}, (_,i)=>`\\[x+${i}\\]`).join('\n\n'), true);
    expect(element.querySelectorAll('.katex')).toHaveLength(256);
    expect(element.querySelectorAll('[data-xopc-math="fallback"]')).toHaveLength(4);
  });
  it.each([false, true])('renders the screenshot and retains MathML, chat=%s', chat => {
    const { element } = render(chat, raw);
    expect(element.querySelector('.katex')).not.toBeNull();
    expect(element.querySelector('math')).not.toBeNull();
    expect(element.querySelector('.markdown-math-actions button')).not.toBeNull();
    expect(element.querySelector('.katex [data-xopc-segment]')).toBeNull();
  });
  it.each([false, true])('finishes pending formulas without remounting the host, chat=%s', chat => {
    const { element, update } = render(chat, '\\[x^', true);
    expect(element.querySelector('[data-xopc-math="pending"]')).not.toBeNull();
    expect(element.querySelector('.katex')).toBeNull();
    update('\\[x^2\\]', false);
    expect(element.querySelector('.katex')).not.toBeNull();
    update('\\[x^', false);
    expect(element.querySelector('[data-xopc-math="fallback"]')).not.toBeNull();
    expect(element.textContent).toContain('\\[x^');
  });
  it.each([false, true])('keeps raw HTML and code outside the math renderer, chat=%s', chat => {
    const { element } = render(chat, '`$x$`\n\n```ts\n\\[x\\]\n```\n\n<script>alert(1)</script>\n\n价格 $5，运费 $10');
    expect(element.querySelector('.katex,script')).toBeNull();
    expect(element.textContent).toContain('$x$');
    expect(element.textContent).toContain('价格 $5，运费 $10');
  });
  it('keeps multiline math intact and preserves incremental block identity', () => {
    const source = 'Intro\n\n\\[\n\\begin{aligned}\na &= b \\\\\n\nc &= d\n\\end{aligned}\n\\]\n\nTail';
    const blocks = parseChatMarkdownBlocks(source);
    expect(blocks.join('')).toBe(source);
    expect(blocks.find(block => block.includes('begin{aligned}'))).toContain('end{aligned}');
    const parse = createChatBlockParser();
    parse(source);
    expect(parse(source + '\n\nMore')).toEqual(parseChatMarkdownBlocks(source + '\n\nMore'));
    const { element } = render(true, source, true);
    expect(element.querySelector('.katex')).not.toBeNull();
  });
  it('preserves formula source when editing other note paragraphs and reloading', () => {
    const markdown = `Before \\(a_i\\)\n\n${raw}\n\nAfter`;
    const editor = new Editor({ extensions: [StarterKit, InlineMath, BlockMath, Markdown.configure(NOTE_MARKDOWN_OPTIONS)], content: markdown });
    disposers.push(() => editor.destroy());
    const saved = serializeNoteMarkdown(editor);
    expect(saved).toContain(raw);
    expect(saved).toContain('\\(a_i\\)');
    editor.commands.insertContentAt(1, 'Edited ');
    const edited = serializeNoteMarkdown(editor);
    editor.commands.setContent(edited);
    expect(serializeNoteMarkdown(editor)).toContain(raw);
    expect(editor.getJSON().content?.some(node => node.type === 'blockMath')).toBe(true);
  });
  it.each([String.raw`\(\unknownCommand{x}\)`, '\\[x^', '```math\nx^2\n```', '$$x^2$$'])
    ('retains note formula %s through undo, redo, and HTML paste', source => {
      const editor = new Editor({ extensions: [StarterKit, InlineMath, BlockMath, Markdown.configure(NOTE_MARKDOWN_OPTIONS)],
        content: `Before\n\n${source}` });
      disposers.push(() => editor.destroy());
      const html = editor.getHTML();
      editor.commands.insertContentAt(1, 'Changed ');
      expect(serializeNoteMarkdown(editor)).toContain(source);
      expect(editor.commands.undo()).toBe(true);
      expect(serializeNoteMarkdown(editor)).toContain(source);
      expect(editor.commands.redo()).toBe(true);
      editor.commands.setContent(html);
      expect(serializeNoteMarkdown(editor)).toContain(source);
    });
});
