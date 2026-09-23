import type { TurnOutcome, TurnOutcomeDeliverable } from '@xopcai/gateway-contract';
import {
  Archive,
  ChevronRight,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Files,
  Globe2,
} from 'lucide-react';

import { AttachmentPreviewDialog } from '@/features/chat/attachments/attachment-preview-dialog';
import {
  formatFileSize,
  getAttachmentBinaryPayload,
} from '@/features/chat/attachments/attachment-utils-core';
import { useAttachmentImageSrc } from '@/features/chat/attachments/use-attachment-image-src';
import { useAttachmentPreview } from '@/features/chat/attachments/use-attachment-preview';
import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import {
  productDeliveryDiffPresentations,
  productDeliveryQueryState,
  productDeliveryReferences,
} from '@/features/chat/product-delivery/product-delivery-model';
import { ProductDeliveryRows } from '@/features/chat/product-delivery/product-delivery-tail';
import { ProductDeliveryDiffPreview } from '@/features/chat/product-delivery/product-delivery-diff-preview';
import { TurnTail } from '@/features/chat/product-delivery/turn-tail';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import type { AssistantTurnViewModel } from './assistant-turn-view-model';

type ResultAttachment = {
  key: string;
  attachment: MessageAttachment;
  meta: string;
  href?: string;
  failed?: boolean;
};

function attachmentFromDeliverable(deliverable: TurnOutcomeDeliverable): MessageAttachment {
  return {
    id: deliverable.artifactId,
    name: deliverable.title,
    type: deliverable.kind,
    mimeType: deliverable.mimeType,
    size: deliverable.sizeBytes,
    uri: deliverable.uri,
    workspaceRelativePath: deliverable.workspaceRelativePath,
  };
}

function resultAttachmentIcon(attachment: MessageAttachment) {
  const mime = attachment.mimeType?.toLowerCase() ?? '';
  const type = attachment.type?.toLowerCase() ?? '';
  if (mime.startsWith('image/') || type === 'image') return FileImage;
  if (mime.startsWith('audio/') || type === 'audio' || type === 'voice') return FileAudio;
  if (mime.startsWith('video/') || type === 'video') return FileVideo;
  if (mime.includes('spreadsheet') || ['spreadsheet', 'csv', 'xlsx', 'xls'].includes(type)) return FileSpreadsheet;
  if (mime.includes('zip') || ['archive', 'zip'].includes(type)) return Archive;
  if (type === 'site') return Globe2;
  return FileText;
}

function canPreviewAttachment(
  attachment: MessageAttachment,
  conversationId?: string | null,
  projectId?: string | null,
): boolean {
  return Boolean(
    attachment.uri
    || getAttachmentBinaryPayload(attachment)
    || (attachment.workspaceRelativePath?.trim() && (conversationId?.trim() || projectId?.trim())),
  );
}

function ResultAttachmentRow({
  item,
  authToken,
  conversationId,
  projectId,
  onOpen,
}: {
  item: ResultAttachment;
  authToken?: string;
  conversationId?: string | null;
  projectId?: string | null;
  onOpen: (attachment: MessageAttachment) => void;
}) {
  const image = useAttachmentImageSrc(item.attachment, { authToken, conversationId });
  const Icon = resultAttachmentIcon(item.attachment);
  const canPreview = canPreviewAttachment(item.attachment, conversationId, projectId);
  const canOpen = canPreview || Boolean(item.href);
  const content = (
    <>
      {image.src ? (
        <img
          src={image.src}
          alt=""
          className="size-8 shrink-0 rounded-lg object-cover"
          decoding="async"
          loading="lazy"
        />
      ) : (
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            item.failed ? 'bg-danger-soft text-danger' : 'bg-accent-soft/70 text-accent-fg',
          )}
          aria-hidden
        >
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg" title={item.attachment.name ?? 'File'}>
          {item.attachment.name ?? 'File'}
        </span>
        <span className="mt-0.5 block truncate text-xs leading-5 text-fg-muted" title={item.meta}>{item.meta}</span>
      </span>
      {canOpen ? <ChevronRight className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden /> : null}
    </>
  );
  const className = cn(
    'flex min-h-14 w-full min-w-0 items-center gap-3 px-3 py-2 text-left',
    canOpen && 'cursor-pointer hover:bg-surface-hover/65 active:bg-surface-active/70',
    interaction.transition,
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
    !canOpen && 'cursor-default',
  );

  if (!canPreview && item.href) {
    return (
      <li data-result-attachment>
        <a
          href={item.href}
          target="_blank"
          rel="noreferrer"
          className={className}
        >
          {content}
        </a>
      </li>
    );
  }

  if (!canPreview) {
    return (
      <li className={className} data-result-attachment>
        {content}
      </li>
    );
  }

  return (
    <li data-result-attachment>
      <button
        type="button"
        className={className}
        onClick={() => onOpen(item.attachment)}
      >
        {content}
      </button>
    </li>
  );
}

function ResultAttachmentGroup({
  attachments,
  authToken,
  conversationId,
  projectId,
  onOpen,
  language,
}: {
  attachments: ResultAttachment[];
  authToken?: string;
  conversationId?: string | null;
  projectId?: string | null;
  onOpen: (attachment: MessageAttachment) => void;
  language: 'en' | 'zh';
}) {
  const label = messages(language).chat.turnOutcome.fileCount
    .replace('{{count}}', String(attachments.length));

  return (
    <li data-result-attachment-group>
      <details className="group">
        <summary
          className={cn(
            'flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2 text-left',
            'hover:bg-surface-hover/65 active:bg-surface-active/70',
            interaction.transition,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          )}
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft/70 text-accent-fg"
            aria-hidden
          >
            <Files className="size-4" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1 text-sm font-medium text-fg">{label}</span>
          <ChevronRight
            className="size-4 shrink-0 text-fg-subtle transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
            strokeWidth={1.75}
            aria-hidden
          />
        </summary>
        <ul className="m-0 list-none divide-y divide-edge-subtle border-t border-edge-subtle p-0">
          {attachments.map((item) => (
            <ResultAttachmentRow
              key={item.key}
              item={item}
              authToken={authToken}
              conversationId={conversationId}
              projectId={projectId}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}

function outcomeAttachments(outcome: TurnOutcome | undefined, language: 'en' | 'zh'): ResultAttachment[] {
  if (!outcome) return [];
  const t = messages(language).chat.turnOutcome;
  return outcome.deliverables.map((deliverable) => {
    const attachment = attachmentFromDeliverable(deliverable);
    return {
      key: `outcome:${deliverable.artifactId}`,
      attachment,
      href: deliverable.shareUrl,
      failed: deliverable.availability === 'failed' || deliverable.availability === 'missing',
      meta: [
        t.availability[deliverable.availability],
        deliverable.sizeBytes !== undefined ? formatFileSize(deliverable.sizeBytes) : null,
      ].filter(Boolean).join(' · '),
    };
  });
}

function standaloneAttachments(
  attachments: MessageAttachment[] | undefined,
  language: 'en' | 'zh',
): ResultAttachment[] {
  const t = messages(language).chat.turnOutcome;
  return (attachments ?? []).map((attachment, index) => ({
    key: `attachment:${attachment.id ?? attachment.uri ?? attachment.name ?? index}`,
    attachment,
    meta: [
      t.generatedFile,
      attachment.mimeType,
      typeof attachment.size === 'number' ? formatFileSize(attachment.size) : null,
    ].filter(Boolean).join(' · '),
  }));
}

export function AssistantResultTail({
  view,
  authToken,
  conversationId,
  projectId,
}: {
  view: AssistantTurnViewModel;
  authToken?: string;
  conversationId?: string | null;
  projectId?: string | null;
}) {
  const localeLanguage = useLocaleStore((state) => state.language);
  const language = localeLanguage === 'zh' ? 'zh' : 'en';
  const preview = useAttachmentPreview({ layout: 'assistant', conversationId, projectId });
  const diffPresentations = productDeliveryDiffPresentations(view.deliveries);
  const queryState = productDeliveryQueryState(view.deliveries);
  const productCount = productDeliveryReferences(view.deliveries).length;
  const attachments = [
    ...outcomeAttachments(view.outcome, language),
    ...standaloneAttachments(view.attachments, language),
  ];
  const hasTail = productCount > 0 || attachments.length > 0;

  if (diffPresentations.length === 0 && !hasTail) return null;

  return (
    <>
      {diffPresentations.map(({ key, presentation }) => (
        <ProductDeliveryDiffPreview key={key} presentation={presentation} />
      ))}
      {hasTail ? (
        <TurnTail label={language === 'zh' ? '本轮交付结果' : 'Turn deliverables'}>
          <ul className="m-0 list-none divide-y divide-edge-subtle p-0">
            <ProductDeliveryRows deliveries={view.deliveries} language={language} />
            {attachments.length > 1 ? (
              <ResultAttachmentGroup
                attachments={attachments}
                authToken={authToken}
                conversationId={conversationId}
                projectId={projectId}
                onOpen={preview.openAttachment}
                language={language}
              />
            ) : (
              attachments.map((item) => (
                <ResultAttachmentRow
                  key={item.key}
                  item={item}
                  authToken={authToken}
                  conversationId={conversationId}
                  projectId={projectId}
                  onOpen={preview.openAttachment}
                />
              ))
            )}
          </ul>
          {queryState.truncated ? (
            <p role="status" className="border-t border-edge-subtle px-3 py-2 text-xs text-fg-muted">
              {language === 'zh' ? '仅显示部分结果' : 'Showing partial results'}
            </p>
          ) : null}
        </TurnTail>
      ) : null}
      {attachments.length > 0 ? (
        <AttachmentPreviewDialog
          open={preview.open}
          attachment={preview.active}
          authToken={authToken}
          conversationId={conversationId}
          onClose={preview.closePreview}
        />
      ) : null}
    </>
  );
}
