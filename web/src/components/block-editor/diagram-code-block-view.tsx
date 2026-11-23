import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { messages } from '@/i18n/messages';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { useLocaleStore } from '@/stores/locale-store';

const CODE_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'plaintext', label: 'Plain text' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'bash', label: 'Bash / Shell' },
  { value: 'json', label: 'JSON' },
  { value: 'sql', label: 'SQL' },
  { value: 'html', label: 'HTML / XML' },
  { value: 'css', label: 'CSS' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'yaml', label: 'YAML' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'mermaid', label: 'Mermaid' },
];

export function DiagramCodeBlockView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const language = useLocaleStore((s) => s.language);
  const zh = language === 'zh';
  const labels = messages(language).notes;
  const rawLang = String(node.attrs.language ?? '').trim().toLowerCase();
  const isMermaid = rawLang === 'mermaid';
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

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
    return () => {
      editor.off('selectionUpdate', revealSelection);
    };
  }, [editor, getPos, isMermaid, node.nodeSize]);

  // A longer fence keeps backticks inside diagram labels in the code block.
  const fence = '`'.repeat(
    Math.max(3, ...Array.from(node.textContent.matchAll(/`+/g), (match) => match[0].length + 1)),
  );

  const selectedLabel =
    CODE_LANGUAGES.find((item) => item.value === rawLang)?.label || rawLang || 'Plain text';

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(node.textContent);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <NodeViewWrapper className={isMermaid ? 'block-editor-mermaid min-w-0' : 'block-editor-code-wrap min-w-0'}>
      <div contentEditable={false}>
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-fg-muted">
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span>{isMermaid ? 'Mermaid' : selectedLabel}</span>
                <ChevronDown className="size-3 text-fg-subtle" aria-hidden />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={4}
                className="z-50 max-h-64 min-w-36 overflow-y-auto rounded-lg border border-edge bg-surface-overlay p-1 shadow-popover"
              >
                {CODE_LANGUAGES.map((item) => (
                  <DropdownMenu.Item
                    key={item.value}
                    onSelect={() => {
                      updateAttributes({ language: item.value === 'plaintext' ? null : item.value });
                      if (item.value === 'mermaid') setShowSource(false);
                    }}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
                  >
                    <span>{item.label}</span>
                    {(rawLang || 'plaintext') === item.value ? (
                      <Check className="size-3.5 text-accent" aria-hidden />
                    ) : null}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title={zh ? '复制代码' : 'Copy code'}
            >
              {copied ? <Check className="size-3 text-accent" aria-hidden /> : <Copy className="size-3" aria-hidden />}
              <span>{copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}</span>
            </button>

            {isMermaid ? (
              <button
                type="button"
                aria-pressed={showSource}
                className="rounded-md px-2 py-1 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => setShowSource((shown) => !shown)}
              >
                {showSource ? labels.modePreview : labels.modeSource}
              </button>
            ) : null}
          </div>
        </div>

        {isMermaid && !showSource && (
          <MarkdownView content={`${fence}mermaid\n${node.textContent}\n${fence}`} mermaidActions />
        )}
      </div>

      <pre className="block-editor-code" hidden={isMermaid && !showSource}>
        <NodeViewContent<'code'>
          as="code"
          className={node.attrs.language ? `language-${node.attrs.language}` : undefined}
        />
      </pre>
    </NodeViewWrapper>
  );
}
