import { useContext } from 'react';
import { AutomationConfigurationContext } from '@/features/automations/automation-configuration-context';
import type { TurnOutcome } from '@xopcai/gateway-contract';
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
import { AttachmentRenderer } from '@/features/chat/attachments/attachment-renderer';
import {
  attachmentFromDeliverable,
  formatFileSize,
  getAttachmentBinaryPayload,
} from '@/features/chat/attachments/attachment-utils-core';
import { useAttachmentImageSrc } from '@/features/chat/attachments/use-attachment-image-src';
import { useAttachmentPreview } from '@/features/chat/attachments/use-attachment-preview';
import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import {
  productDeliveryDiffPresentations,
  productDeliveryInlineApps,
  productDeliveryInlinePreviews,
  isProductDeliveryVisibleResult,
  productDeliveryQueryState,
  productDeliveryReferences,
} from '@/features/chat/product-delivery/product-delivery-model';
import { ProductDeliveryRows } from '@/features/chat/product-delivery/product-delivery-tail';
import { ProductDeliveryDiffPreview } from '@/features/chat/product-delivery/product-delivery-diff-preview';
import { InlineLocalApp } from '@/features/chat/product-delivery/inline-local-app';
import { InlineChatPreview } from '@/features/chat/product-delivery/inline-chat-preview';
import { TurnTail } from '@/features/chat/product-delivery/turn-tail';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { AssistantCapsuleContent, assistantCapsuleClassName, assistantCapsuleDetailClassName, assistantCapsuleListClassName } from './assistant-capsule';
import type { AssistantTurnViewModel } from './assistant-turn-view-model';

type ResultAttachment = {
  key: string;
  attachment: MessageAttachment;
  meta: string;
  href?: string;
  failed?: boolean;
};

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
  const language = useLocaleStore(state => state.language);
  const fileLabel = messages(language).chat.productDelivery.kinds.file;
  const image = useAttachmentImageSrc(item.attachment, { authToken, conversationId });
  const Icon = resultAttachmentIcon(item.attachment);
  const canPreview = canPreviewAttachment(item.attachment, conversationId, projectId);
  const canOpen = canPreview || Boolean(item.href);
  const content = <AssistantCapsuleContent
    icon={image.src ? <img src={image.src} alt="" className="size-[18px] rounded object-cover" decoding="async" loading="lazy" /> : <Icon strokeWidth={1.75} className={item.failed ? 'text-danger' : undefined} />}
    title={item.attachment.name ?? fileLabel}
    meta={item.meta}
    trailing={canOpen ? <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden /> : null}
  />;
  const className = cn(assistantCapsuleClassName, canOpen ? 'cursor-pointer' : 'cursor-default');
  const title = [item.attachment.name ?? fileLabel, item.meta].join(' · ');

  if (!canPreview && item.href) {
    return (
      <li className="min-w-0 max-w-full" data-result-attachment>
        <a
          title={title}
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
    <li className="min-w-0 max-w-full" data-result-attachment>
      <button
        type="button"
        className={className}
        title={title}
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
    <li className="min-w-0 max-w-full" data-result-attachment-group>
      <details className="group">
        <summary className={cn(assistantCapsuleClassName, 'cursor-pointer list-none')}>
          <AssistantCapsuleContent icon={<Files strokeWidth={1.75} />} title={label}
            trailing={<ChevronRight className="size-3.5 shrink-0 text-fg-subtle transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" aria-hidden />} />
        </summary>
        <ul className={cn(assistantCapsuleListClassName, assistantCapsuleDetailClassName)}>
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
      typeof attachment.size === 'number' ? formatFileSize(attachment.size) : null,
    ].filter(Boolean).join(' · '),
  }));
}

function outcomeFileReferenceKeys(outcome: TurnOutcome | undefined): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const deliverable of outcome?.deliverables ?? []) {
    for (const id of [deliverable.artifactId, deliverable.sourceFileId, deliverable.workspaceRelativePath]) {
      const value = id?.trim();
      if (value) keys.add(`file:${value}`);
    }
  }
  return keys;
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
  const visibleDeliveries = view.deliveries.filter(({ delivery }) => isProductDeliveryVisibleResult(delivery));
  const diffPresentations = productDeliveryDiffPresentations(visibleDeliveries);
  const inlineApps = productDeliveryInlineApps(visibleDeliveries);
  const inlinePreviews = productDeliveryInlinePreviews(visibleDeliveries);
  const queryState = productDeliveryQueryState(visibleDeliveries);
  const inAutomationConfiguration = useContext(AutomationConfigurationContext);
  const supersededFileReferences = new Set(outcomeFileReferenceKeys(view.outcome));
  if (inAutomationConfiguration) {
    for (const { delivery, reference } of productDeliveryReferences(visibleDeliveries)) {
      if (reference.kind === 'automation' && !reference.runId && delivery.operation !== 'failed') supersededFileReferences.add(`automation:${reference.id}`);
    }
  }
  const productCount = productDeliveryReferences(visibleDeliveries, supersededFileReferences).length;
  const allAttachments = [
    ...outcomeAttachments(view.outcome, language),
    ...standaloneAttachments(view.attachments, language),
  ];
  const isVersionedResult = (attachment: MessageAttachment) => Boolean(
    view.resultRevision && view.outcome?.deliverables.some(item => item.artifactId === attachment.id),
  );
  const openResult = (attachment: MessageAttachment) => {
    preview.openAttachment(attachment, isVersionedResult(attachment) ? view.resultRevision : undefined);
  };
  const images = allAttachments.filter(item => !item.failed && item.attachment.mimeType?.startsWith('image/'));
  const attachments = allAttachments.filter(item => !images.includes(item));
  const hasTail = productCount > 0 || attachments.length > 0;

  if (diffPresentations.length === 0 && inlineApps.length === 0 && inlinePreviews.length === 0 && !hasTail && !images.length) return null;

  return (
    <>
      {images.length > 0 ? (
        <AttachmentRenderer attachments={images.map(item => item.attachment)} authToken={authToken}
          conversationId={conversationId} workspaceConversationId={conversationId} layout="assistant" />
      ) : null}
      {diffPresentations.map(({ key, presentation }) => (
        <ProductDeliveryDiffPreview key={key} presentation={presentation} />
      ))}
      {inlineApps.map(({ key, presentation }) => (
        <InlineLocalApp
          key={key}
          previewId={`${key}:${presentation.reference.id}:${presentation.snapshot.sourceHash}`}
          reference={presentation.reference}
          sourceHash={presentation.snapshot.sourceHash}
          preferredHeight={presentation.preferredHeight}
          language={language}
        />
      ))}
      {inlinePreviews.map(({ key, presentation }) => (
        <InlineChatPreview
          key={key}
          leaseId={`${key}:${presentation.reference.id}:${presentation.sourceHash}`}
          reference={presentation.reference}
          sourceHash={presentation.sourceHash}
          preferredHeight={presentation.preferredHeight}
          language={language}
        />
      ))}
      {hasTail ? (
        <TurnTail label={messages(language).chat.productDelivery.heading}>
          <ul className={assistantCapsuleListClassName}>
            <ProductDeliveryRows
              deliveries={visibleDeliveries}
              language={language}
              excludedReferenceKeys={supersededFileReferences}
              conversationId={conversationId}
              projectId={projectId}
            />
            {attachments.length > 1 ? (
              <ResultAttachmentGroup
                attachments={attachments}
                authToken={authToken}
                conversationId={conversationId}
                projectId={projectId}
                onOpen={openResult}
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
                  onOpen={openResult}
                />
              ))
            )}
          </ul>
          {queryState.truncated ? (
            <p role="status" className="mt-2 text-xs text-fg-muted">
              {messages(language).chat.productDelivery.partialResults}
            </p>
          ) : null}
        </TurnTail>
      ) : null}
      {attachments.length > 0 ? (
        <AttachmentPreviewDialog
          open={preview.open}
          attachment={preview.active}
          resultRevision={preview.active && isVersionedResult(preview.active) ? view.resultRevision : undefined}
          authToken={authToken}
          conversationId={conversationId}
          onClose={preview.closePreview}
        />
      ) : null}
    </>
  );
}
