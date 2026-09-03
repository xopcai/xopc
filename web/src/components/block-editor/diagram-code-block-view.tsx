import { useEffect, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function DiagramCodeBlockView({ node, editor, getPos }: NodeViewProps) {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language).notes;
  const isMermaid = String(node.attrs.language ?? '').toLowerCase() === 'mermaid';
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (!isMermaid) return;
    // Reveal the editable content when keyboard navigation enters the code block.
    const revealSelection = () => {
      const pos = getPos();
      const { from, to } = editor.state.selection;
      if (typeof pos === 'number' && from > pos && to < pos + node.nodeSize) {
        setShowSource(true);
      }
    };
    editor.on('selectionUpdate', revealSelection);
    return () => { editor.off('selectionUpdate', revealSelection); };
  }, [editor, getPos, isMermaid, node.nodeSize]);

  // A longer fence keeps backticks inside diagram labels in the code block.
  const fence = '`'.repeat(Math.max(3, ...Array.from(node.textContent.matchAll(/`+/g), (match) => match[0].length + 1)));

  return (
    <NodeViewWrapper className={isMermaid ? 'block-editor-mermaid min-w-0' : undefined}>
      {isMermaid && (
        <div contentEditable={false}>
          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
            <span>Mermaid</span>
            <button
              type="button"
              aria-pressed={showSource}
              className="rounded-md px-2 py-1 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => setShowSource((shown) => !shown)}
            >
              {showSource ? labels.modePreview : labels.modeSource}
            </button>
          </div>
          {!showSource && (
            <MarkdownView content={`${fence}mermaid\n${node.textContent}\n${fence}`} mermaidActions />
          )}
        </div>
      )}
      <pre className="block-editor-code" hidden={isMermaid && !showSource}>
        <NodeViewContent<'code'> as="code" className={node.attrs.language ? `language-${node.attrs.language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
}
