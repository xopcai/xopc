import { Node, ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type MarkdownIt from 'markdown-it';
import { markdownItMath } from '@xopcai/markdown-math/markdownIt';
import { renderMathHtml } from '@xopcai/markdown-math/render';
import { decodeMathSource, encodeMathSource } from '@xopcai/markdown-math/syntax';
import { useState } from 'react';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

interface MarkdownSerializerState { text(value: string, escape: boolean): void; closeBlock(node: ProseMirrorNode): void; }

function MathNodeView({ node, updateAttributes }: NodeViewProps) {
  const labels = messages(useLocaleStore(s => s.language)).chat;
  const source = decodeMathSource(String(node.attrs.source));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source?.latex ?? '');
  if (!source) return <NodeViewWrapper>LaTeX</NodeViewWrapper>;
  const save = () => {
    let raw: string;
    if (source.delimiter === 'math-fence') {
      const marker = source.raw.match(/^ {0,3}(`{3,}|~{3,})/)?.[1] ?? '```';
      const fence = marker[0].repeat(Math.max(marker.length, ...Array.from(draft.matchAll(marker[0] === '`' ? /`+/g : /~+/g), m => m[0].length + 1)));
      raw = `${fence}math\n${draft}\n${fence}`;
    } else {
      const [open, close] = source.delimiter === 'paren' ? ['\\(', '\\)'] : source.delimiter === 'dollar' ? ['$', '$']
        : source.delimiter === 'bracket' ? ['\\[', '\\]'] : ['$$', '$$'];
      raw = source.display ? `${open}\n${draft}\n${close}` : `${open}${draft}${close}`;
    }
    updateAttributes({ source: encodeMathSource({ ...source, latex: draft, raw, state: 'complete', range: { start: 0, end: raw.length } }) });
    setEditing(false);
  };
  return <NodeViewWrapper as={source.display ? 'div' : 'span'} className="block-editor-math" contentEditable={false}>
    {editing ? <span className="block-editor-math-edit">
      <textarea aria-label="LaTeX" value={draft} onChange={e => setDraft(e.target.value)} />
      <button type="button" onClick={save}>{labels.mathSave}</button>
      <button type="button" onClick={() => setEditing(false)}>{labels.mathCancel}</button>
    </span> : <span role="button" tabIndex={0} aria-label="LaTeX" onClick={() => { setDraft(source.latex); setEditing(true); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDraft(source.latex); setEditing(true); } }}
      dangerouslySetInnerHTML={{ __html: renderMathHtml(source) }} />}
  </NodeViewWrapper>;
}

function mathNode(display: boolean) {
  return Node.create({
    name: display ? 'blockMath' : 'inlineMath', priority: 1000,
    group: display ? 'block' : 'inline', inline: !display, atom: true,
    addAttributes() { return { source: { default: '' } }; },
    parseHTML() {
      const getAttrs = (element: HTMLElement) => {
        const encoded = element.getAttribute('data-xopc-math-source') ?? element.querySelector('code')?.getAttribute('data-xopc-math-source') ?? '';
        const source = decodeMathSource(encoded);
        return source?.display === display ? { source: encoded } : false;
      };
      return display ? [{ tag: 'pre', getAttrs }, { tag: 'div[data-xopc-math-source]', getAttrs }]
        : [{ tag: 'code.math-inline[data-xopc-math-source]', getAttrs }, { tag: 'span[data-xopc-math-source]', getAttrs }];
    },
    renderHTML({ node }) {
      const source = decodeMathSource(String(node.attrs.source));
      return [display ? 'div' : 'span', { 'data-xopc-math-source': node.attrs.source }, source?.raw ?? ''];
    },
    addNodeView() { return ReactNodeViewRenderer(MathNodeView); },
    addStorage() {
      return { markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const source = decodeMathSource(String(node.attrs.source));
          if (!source) return;
          state.text(source.raw, false);
          if (display) state.closeBlock(node);
        },
        parse: { setup(md: MarkdownIt) { markdownItMath(md, { placeholder: true }); } },
      } };
    },
  });
}

export const InlineMath = mathNode(false);
export const BlockMath = mathNode(true);
