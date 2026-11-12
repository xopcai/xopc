import { useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { parseFileResourceArtifactUri, productReferenceRoute, type PersonalDeliverable } from '@xopcai/gateway-contract';
import { X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { attachmentFromDeliverable } from '@/features/chat/attachments/attachment-utils-core';
import { InlineChatPreview } from '@/features/chat/product-delivery/inline-chat-preview';
import { chatProductHref } from '@/features/chat/product-preview/product-preview-route';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';

function externalUrl(value: string | undefined) {
  if (!value) return undefined;
  const url = URL.parse(value, window.location.origin);
  return url && ['http:', 'https:'].includes(url.protocol) && /^(?:https?:\/\/|\/(?!\/))/i.test(value) ? url.href : undefined;
}

export function DeliverablePreview({ item, workspaceScope, conversationId, backgroundPath, zh, className, children }: {
  item: PersonalDeliverable; workspaceScope?: string; conversationId?: string; backgroundPath: string;
  zh: boolean; className: string; children: ReactNode;
}) {
  const { artifact, reference, task } = item;
  const [previewOpen, setPreviewOpen] = useState(false);
  const title = artifact?.title ?? reference?.title ?? item.id;
  const productHref = reference && productReferenceRoute(reference);
  const sourceHash = reference?.kind === 'chat_preview' ? reference.revision : undefined;
  const url = externalUrl(artifact?.uri) ?? externalUrl(artifact?.shareUrl);
  const fileUri = artifact?.uri;
  const filePreview = Boolean(fileUri?.startsWith('media://') || (fileUri && parseFileResourceArtifactUri(fileUri)) || artifact?.workspaceRelativePath);
  const desktopBrowser = Boolean(url && window.electronAPI?.browser);
  return (productHref ? <Link to={chatProductHref(backgroundPath, productHref)} className={className}>{children}</Link>
    : reference && sourceHash ? <Dialog.Root open={previewOpen} onOpenChange={setPreviewOpen}>
      <Dialog.Trigger className={className}>{children}</Dialog.Trigger>
      {previewOpen ? <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[90] bg-black/45" />
        <Dialog.Content onKeyDown={event => event.stopPropagation()}
          className="xopc-dialog-content fixed left-1/2 top-1/2 z-[91] flex h-[min(42rem,calc(100dvh-2rem))] w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge">
          <header className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
            <Dialog.Title className="truncate font-medium text-fg">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{zh ? '预览网页交付物' : 'Preview web deliverable'}</Dialog.Description>
            <Dialog.Close aria-label={zh ? '关闭预览' : 'Close preview'} className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-surface-hover"><X className="size-4" /></Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <InlineChatPreview leaseId={`personal-deliverable:${item.id}`} reference={reference}
              sourceHash={sourceHash} preferredHeight={480} language={zh ? 'zh' : 'en'} />
          </div>
        </Dialog.Content>
      </Dialog.Portal> : null}
    </Dialog.Root>
    : filePreview || desktopBrowser ? <button type="button" className={className} onClick={() => {
      const store = useRightWorkspaceStore.getState();
      if (filePreview && artifact) store.openFile({ attachment: { ...attachmentFromDeliverable(artifact), taskId: task?.id }, conversationId }, workspaceScope);
      else store.openBrowser(url, workspaceScope);
    }}>{children}</button> : url ? <a href={url} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
      : <div className={className}>{children}</div>);
}
