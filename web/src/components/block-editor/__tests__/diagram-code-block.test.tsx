// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { parseMermaid } from 'beautiful-mermaid';
import { NOTE_MARKDOWN_OPTIONS, serializeNoteMarkdown } from '@xopcai/note-editor-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoteMarkdownView } from '@/features/notes/note-markdown-view';

import { DiagramCodeBlock } from '../extensions/diagram-code-block';
import { BlockEditor } from '../block-editor';

vi.mock('../link-bubble-menu', () => ({ LinkBubbleMenu: () => null }));

const architecture = `flowchart TB
  subgraph Authoring[作者与发布]
    SRC[Git / Authoring Source<br/>Skill · Toolset Binding · Policy Claims · Evals]
    PUB[Package Publisher<br/>lint → contract check → security review → eval gate]
    REG[(Capability Package Registry<br/>immutable artifact + digest + channel)]
    SRC --> PUB --> REG
  end

  subgraph Resolution[运行时解析]
    INS[Installation]
    ORG[Org / Workspace Policy]
    GRANT[Live Credential Grants]
    RT[Runtime Backend / Rollout Lane]
    RES[Package Resolver]
    SNAP[Resolved Capability Snapshot<br/>resolutionId · digests · allowed capabilities/tools]
    INS & ORG & GRANT & RT --> RES --> SNAP
    REG --> RES
  end

  subgraph Runtime[Agent 与执行]
    FS[TodayFS exact-version view]
    DIR[Tool Directory / Search]
    AGENT[Agent Runtime]
    GW[Tool Gateway]
    IS[integration-service]
    BACKEND[MCP / Managed Tool / BFF / Provider API]
    SNAP --> FS & DIR
    FS & DIR --> AGENT
    AGENT -->|resolutionId + invocation| GW --> IS --> BACKEND
    SNAP -.可信上下文校验.-> GW
  end`;
const markdown = `## 5. 目标终态架构\n\n\`\`\`mermaid\n${architecture}\n\`\`\``;
const cleanups: Array<() => void> = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body });

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => act(cleanup));
  vi.restoreAllMocks();
});

function renderNote(content: string, preview = false) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  act(() => root.render(
    <MemoryRouter>
      {preview ? <NoteMarkdownView content={content} /> : <BlockEditor initialContent={content} onChange={onChange} />}
    </MemoryRouter>,
  ));
  cleanups.push(() => { root.unmount(); container.remove(); });
  return { container, onChange };
}

describe('note Mermaid diagrams', () => {
  it('preserves all architecture edges including compact dotted labels and parallel links', () => {
    const graph = parseMermaid(architecture);
    expect(graph.nodes.size).toBe(15);
    expect(graph.edges).toHaveLength(16);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'SNAP', target: 'GW', label: '可信上下文校验', style: 'dotted' }),
      ...['INS', 'ORG', 'GRANT', 'RT'].map((source) => expect.objectContaining({ source, target: 'RES' })),
      ...['FS', 'DIR'].map((target) => expect.objectContaining({ source: 'SNAP', target })),
    ]));
  });

  it.each([false, true])('renders the complete architecture in preview=%s', async (preview) => {
    const { container, onChange } = renderNote(markdown, preview);
    await vi.waitFor(() => expect(container.querySelector('[data-mermaid-diagram] svg')).not.toBeNull());
    const svg = container.querySelector('[data-mermaid-diagram] svg')!;
    expect(svg.textContent).toContain('作者与发布');
    expect(svg.textContent).toContain('运行时解析');
    expect(svg.textContent).toContain('Agent 与执行');
    expect(svg.textContent).toContain('可信上下文校验');
    expect(svg.textContent).not.toContain('<br');
    expect(container.querySelector('[data-mermaid-error]')).toBeNull();
    expect(container.querySelector('[data-mermaid-action="preview"]')).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('allows switching to the original source and back without saving UI markup', async () => {
    const { container, onChange } = renderNote(markdown);
    await vi.waitFor(() => expect(container.querySelector('[data-mermaid-diagram] svg')).not.toBeNull());
    const toggle = container.querySelector<HTMLButtonElement>('.block-editor-mermaid button[aria-pressed]')!;
    const source = container.querySelector<HTMLPreElement>('.block-editor-mermaid pre')!;
    expect(source.hidden).toBe(true);
    act(() => toggle.click());
    expect(source.hidden).toBe(false);
    expect(source.textContent).toBe(architecture);
    act(() => toggle.click());
    expect(source.hidden).toBe(true);
    expect(container.querySelector('[data-mermaid-diagram] svg')).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps malformed Mermaid editable and ordinary code blocks as code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = renderNote('```mermaid\nnot a diagram\n```\n\n```ts\nconst value = 1;\n```');
    await vi.waitFor(() => expect(container.querySelector('[data-mermaid-error]')).not.toBeNull());
    act(() => container.querySelector<HTMLButtonElement>('.block-editor-mermaid button[aria-pressed]')!.click());
    expect(container.querySelector('.block-editor-mermaid pre')?.textContent).toBe('not a diagram');
    expect(container.querySelector('code.language-ts')?.textContent).toBe('const value = 1;');
    expect(container.querySelector<HTMLPreElement>('code.language-ts')?.closest('pre')?.hidden).toBe(false);
  });

  it('reveals the source on text selection and renders edits when returning to preview', async () => {
    const { container, onChange } = renderNote(markdown);
    await vi.waitFor(() => expect(container.querySelector('[data-mermaid-diagram] svg')).not.toBeNull());
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    let codePos = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'codeBlock') codePos = pos; });
    const start = codePos + 1 + architecture.indexOf('TodayFS');
    act(() => { editor.commands.setTextSelection(start); });
    expect(container.querySelector<HTMLPreElement>('.block-editor-mermaid pre')?.hidden).toBe(false);
    act(() => { editor.view.dispatch(editor.state.tr.insertText('UpdatedFS', start, start + 'TodayFS'.length)); });
    expect(onChange).toHaveBeenLastCalledWith(markdown.replace('TodayFS', 'UpdatedFS'));
    act(() => container.querySelector<HTMLButtonElement>('.block-editor-mermaid button[aria-pressed]')!.click());
    expect(container.querySelector('[data-mermaid-diagram] svg')?.textContent).toContain('UpdatedFS');
  });

  it('preserves Mermaid language and source through edits and Markdown reload', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ codeBlock: false }), DiagramCodeBlock, Markdown.configure(NOTE_MARKDOWN_OPTIONS)],
      content: markdown,
    });
    cleanups.push(() => editor.destroy());
    expect(serializeNoteMarkdown(editor)).toBe(markdown);
    let codePos = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'codeBlock') codePos = pos; });
    editor.view.dispatch(editor.state.tr.insertText('\n  GW --> DIR', codePos + 1 + architecture.length));
    const saved = serializeNoteMarkdown(editor);
    expect(saved).toContain('```mermaid\n');
    expect(saved).toContain(`${architecture}\n  GW --> DIR`);
    expect(saved).not.toContain('<svg');
    editor.commands.setContent(saved);
    expect(serializeNoteMarkdown(editor)).toBe(saved);
  });
});
