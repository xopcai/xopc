import { BubbleMenu } from '@tiptap/react/menus';
import { useEditorState, type Editor } from '@tiptap/react';
import { Check, Copy, ExternalLink, Pencil, Unlink, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { useAppLinkOpener } from '@/lib/use-app-link-opener';
import { applyLinkHref } from './link-interaction';

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
  const [editing, setEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const href = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => String(currentEditor.getAttributes('link').href ?? ''),
  });

  useEffect(() => {
    setEditing(false);
  }, [href]);

  useEffect(() => {
    if (editing) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing]);

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

  const commitEdit = () => {
    applyLinkHref(editor, draftUrl);
    setEditing(false);
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
          {editing ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                commitEdit();
              }}
            >
              <input
                ref={inputRef}
                type="text"
                value={draftUrl}
                onChange={(event) => setDraftUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setEditing(false);
                    editor.commands.focus();
                  }
                }}
                placeholder="https://..."
                aria-label="URL"
                className="h-7 w-52 min-w-0 flex-1 rounded-md border border-edge bg-surface-inset px-2 text-xs text-fg outline-none focus:border-accent"
              />
              <button
                type="submit"
                aria-label={labels.edit}
                className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-on-accent hover:bg-accent-hover"
              >
                <Check className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => {
                  setEditing(false);
                  editor.commands.focus();
                }}
                className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            </form>
          ) : (
            <>
              <p className="max-w-xs truncate px-1 pb-2 text-xs text-fg-muted" title={href}>{href}</p>
              <div className="flex flex-wrap items-center gap-1">
                <LinkActionButton label={labels.open} onClick={() => void open()}><ExternalLink /></LinkActionButton>
                <LinkActionButton
                  label={labels.edit}
                  onClick={() => {
                    setDraftUrl(href);
                    setEditing(true);
                  }}
                >
                  <Pencil />
                </LinkActionButton>
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
            </>
          )}
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
