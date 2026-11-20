import { BubbleMenu } from '@tiptap/react/menus';
import { useEditorState, type Editor } from '@tiptap/react';
import { Check, Copy, ExternalLink, Pencil, Unlink } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { useAppLinkOpener } from '@/lib/use-app-link-opener';

import { editSelectedLink } from './link-interaction';

export interface LinkBubbleMenuLabels {
  open: string;
  edit: string;
  copy: string;
  copied: string;
  remove: string;
  openFailed: string;
}

export function LinkBubbleMenu({ editor, labels, scrollTarget }: {
  editor: Editor;
  labels: LinkBubbleMenuLabels;
  scrollTarget: HTMLElement;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const openAppLink = useAppLinkOpener();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const href = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => String(currentEditor.getAttributes('link').href ?? ''),
  });

  const open = async () => {
    setError(null);
    const result = await openAppLink(href);
    if (!result.ok) setError(labels.openFailed);
  };

  const copy = async () => {
    if (!await copyTextToClipboard(href)) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return createPortal(
    <div ref={setHost}>
      {host && <BubbleMenu
          editor={editor}
          appendTo={host}
          updateDelay={0}
          resizeDelay={0}
          shouldShow={({ editor: currentEditor, view }) =>
            (view.hasFocus() || host.contains(document.activeElement)) && currentEditor.isActive('link')}
          options={{
            strategy: 'fixed',
            placement: 'bottom',
            offset: 8,
            shift: { padding: 8 },
            flip: { padding: 8 },
            hide: { boundary: scrollTarget },
            scrollTarget,
          }}
          className="z-[60] max-w-[min(24rem,calc(100vw-1rem))] rounded-lg border border-edge bg-surface-overlay p-2 shadow-popover"
        >
          <p className="max-w-xs truncate px-1 pb-2 text-xs text-fg-muted" title={href}>{href}</p>
          <div className="flex flex-wrap items-center gap-1">
            <LinkActionButton label={labels.open} onClick={() => void open()}><ExternalLink /></LinkActionButton>
            <LinkActionButton label={labels.edit} onClick={() => editSelectedLink(editor)}><Pencil /></LinkActionButton>
            <LinkActionButton label={copied ? labels.copied : labels.copy} onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />}
            </LinkActionButton>
            <LinkActionButton
              label={labels.remove}
              onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
            >
              <Unlink />
            </LinkActionButton>
          </div>
          {error ? <p className="px-1 pt-2 text-xs text-danger" role="alert">{error}</p> : null}
      </BubbleMenu>}
    </div>,
    scrollTarget.closest('[role="dialog"]') ?? document.body,
  );
}

function LinkActionButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactElement<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
    >
      <span className="[&_svg]:size-3.5">{children}</span>
      <span>{label}</span>
    </button>
  );
}
