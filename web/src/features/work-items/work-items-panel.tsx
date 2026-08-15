import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Download, ExternalLink, FileText, MessageSquarePlus, MoreHorizontal, Paperclip, Plus, Target, Trash2, X } from 'lucide-react';
import { type DragEvent, type FormEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { AttachmentPreviewDialog } from '@/features/chat/attachments/attachment-preview-dialog';
import { arrayBufferToBase64 } from '@/features/chat/attachments/attachment-utils-core';
import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { detectPreviewFileType, inferPreviewMimeType } from '@/features/preview-runtime';
import { messages } from '@/i18n/messages';
import { apiFetch } from '@/lib/fetch';
import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { withReturnTo } from '@/lib/navigation-return';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import {
  createWorkItem,
  createWorkItemGoal,
  deleteWorkItemAttachment,
  downloadWorkItemAttachment,
  fetchProjectWorkItems,
  fetchWorkItemEvents,
  patchWorkItem,
  startWorkItemChat,
  uploadWorkItemAttachments,
  workItemAttachmentContentUrl,
  type WorkItem,
  type WorkItemAttachment,
  type WorkItemEvent,
  type WorkItemPriority,
  type WorkItemStatus,
} from './api';

type WorkItemsMessages = ReturnType<typeof messages>['projectDetailPage']['workItems'];
type WorkItemNotice = { title: string; message: string } | null;
type BoardPanState = {
  pointerId: number;
  startX: number;
  scrollLeft: number;
  active: boolean;
};

const DRAG_TYPE = 'application/x-xopc-work-item';
const BOARD_COLUMNS: WorkItemStatus[] = ['backlog', 'todo', 'in_progress', 'blocked', 'needs_input', 'in_review', 'done'];
const PRIORITIES: WorkItemPriority[] = ['low', 'normal', 'high', 'urgent'];

function statusTone(status: WorkItemStatus): string {
  if (status === 'done' || status === 'in_review') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'blocked' || status === 'needs_input') return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (status === 'in_progress') return 'bg-accent-soft text-accent-fg';
  if (status === 'backlog' || status === 'todo') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'bg-surface-muted text-fg-subtle';
}

function formatTime(value: number): string {
  if (!value) return '';
  return formatMediumDateTime(new Date(value));
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function fileDedupeKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function isPreviewableFile(fileName: string, mimeType: string): boolean {
  return detectPreviewFileType(fileName, mimeType) !== 'unsupported';
}

function messageAttachmentType(mimeType: string, fallback?: WorkItemAttachment['type']): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (fallback === 'image' || fallback === 'audio' || fallback === 'video') return fallback;
  return 'document';
}

function workItemAttachmentToMessageAttachment(attachment: WorkItemAttachment, content?: string): MessageAttachment {
  return {
    id: attachment.id,
    name: attachment.fileName,
    type: messageAttachmentType(attachment.mimeType, attachment.type),
    mimeType: attachment.mimeType,
    size: attachment.size,
    ...(content ? { content, preview: attachment.mimeType.startsWith('image/') ? content : undefined } : {}),
  };
}

async function fileToMessageAttachment(file: File, id: string): Promise<MessageAttachment> {
  const mimeType = inferPreviewMimeType(file.name || 'upload', file.type || 'application/octet-stream');
  const content = arrayBufferToBase64(await file.arrayBuffer());
  return {
    id,
    name: file.name || 'upload',
    type: messageAttachmentType(mimeType),
    mimeType,
    size: file.size,
    content,
    preview: mimeType.startsWith('image/') ? content : undefined,
  };
}

function useObjectUrl(blob: Blob | null): string {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!blob) {
      setUrl('');
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  return url;
}

function useWorkItemAttachmentThumbnail(workItemId: string | null, attachment: WorkItemAttachment): string {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!workItemId || !attachment.mimeType.startsWith('image/')) {
      setUrl('');
      return;
    }

    let cancelled = false;
    let revokeUrl = '';

    void (async () => {
      const res = await apiFetch(workItemAttachmentContentUrl(workItemId, attachment.id));
      if (!res.ok || cancelled) return;
      const blob = await res.blob();
      if (cancelled) return;
      revokeUrl = URL.createObjectURL(blob);
      setUrl(revokeUrl);
    })().catch(() => {
      if (!cancelled) setUrl('');
    });

    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [attachment.id, attachment.mimeType, workItemId]);

  return url;
}

function AttachmentPreviewThumb({
  name,
  mimeType,
  thumbnailUrl,
  previewable,
  disabled,
  onOpen,
}: {
  name: string;
  mimeType: string;
  thumbnailUrl: string;
  previewable: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  const isImage = mimeType.startsWith('image/');
  const content = isImage && thumbnailUrl ? (
    <img src={thumbnailUrl} alt={name} className="size-10 rounded-md object-cover" />
  ) : (
    <span className="inline-flex size-10 items-center justify-center rounded-md border border-edge bg-surface-muted">
      <FileText className="size-4 text-fg-muted" aria-hidden />
    </span>
  );

  if (!previewable) return content;

  return (
    <button
      type="button"
      className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel disabled:cursor-wait disabled:opacity-70"
      title={name}
      aria-label={name}
      disabled={disabled}
      onClick={onOpen}
    >
      {content}
    </button>
  );
}

function linkHref(link: NonNullable<WorkItem['links']>[number]): string {
  if (link.kind === 'chat') return `/chat/${encodeURIComponent(link.targetId)}`;
  if (link.kind === 'goal') return `/goals/${encodeURIComponent(link.targetId)}`;
  if (link.kind === 'workflow_run') return `/workflows?run=${encodeURIComponent(link.targetId)}`;
  if (link.kind === 'automation') return `/automations?automationId=${encodeURIComponent(link.targetId)}`;
  return '#';
}

function shouldIgnoreBoardPan(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return Boolean(target.closest('a,button,input,select,textarea,[contenteditable="true"],[draggable="true"],[data-board-pan-skip="true"]'));
}

function visibleSummary(item: WorkItem, t: WorkItemsMessages): string {
  return item.nextAction || item.blockedReason || item.description || t.noNextAction;
}

function WorkItemCard({
  item,
  detailReturnTo,
  dragging,
  onOpen,
  onToggleDone,
  onDragStart,
  onDragEnd,
  t,
}: {
  item: WorkItem;
  detailReturnTo: string;
  dragging: boolean;
  onOpen: (item: WorkItem) => void;
  onToggleDone: (item: WorkItem) => void;
  onDragStart: (item: WorkItem, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  t: WorkItemsMessages;
}) {
  const done = item.status === 'done';

  return (
    <article
      draggable
      onDragStart={(event) => onDragStart(item, event)}
      onDragEnd={onDragEnd}
      title={t.dragToUpdate}
      className={cn(
        'flex min-h-24 w-full min-w-0 max-w-full cursor-grab flex-col overflow-hidden rounded-lg bg-surface-panel p-3 shadow-surface transition-colors hover:bg-surface-hover active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
    >
      <div className="flex min-w-0 max-w-full items-start gap-2">
        <button
          type="button"
          className={cn(
            'mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
            done ? 'border-success bg-success text-white' : 'border-edge bg-surface-base hover:border-accent/50',
          )}
          aria-label={done ? t.markTodo : t.markDone}
          title={done ? t.markTodo : t.markDone}
          onClick={() => onToggleDone(item)}
        >
          {done ? <CheckCircle2 className="size-3" aria-hidden /> : null}
        </button>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(item)}>
          <h4 className="min-w-0 flex-1 basis-0 text-sm font-medium leading-5 text-fg line-clamp-2">{item.title}</h4>
          <p className="mt-2 max-w-full break-words text-xs leading-5 text-fg-muted line-clamp-1">{visibleSummary(item, t)}</p>
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', statusTone(item.status))}>
          {t.statuses[item.status]}
        </span>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">{t.priorities[item.priority]}</span>
        {item.attachments?.length ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">
            <Paperclip className="size-3" aria-hidden />
            {item.attachments.length}
          </span>
        ) : null}
        {item.links?.length ? <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">{item.links.length}</span> : null}
        <Link
          to={withReturnTo(`/work-items/${encodeURIComponent(item.id)}`, detailReturnTo)}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent-soft hover:text-accent-fg"
        >
          {t.detail.openItem}
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>
    </article>
  );
}

function WorkItemCardSkeleton() {
  return (
    <article className="flex h-24 w-full min-w-0 max-w-full flex-col overflow-hidden rounded-lg bg-surface-panel px-3 pt-3 pb-0 shadow-surface">
      <div className="flex items-center gap-2">
        <div className="size-3.5 shrink-0 rounded-full bg-surface-muted" />
        <div className="h-3 w-36 rounded bg-surface-muted" />
      </div>
      <div className="mt-3 h-3 w-48 rounded bg-surface-muted" />
      <div className="mt-3 flex gap-1.5">
        <div className="h-5 w-16 rounded-full bg-surface-muted" />
        <div className="h-5 w-10 rounded-full bg-surface-muted" />
      </div>
    </article>
  );
}

function PendingAttachmentRow({
  file,
  index,
  busy,
  previewBusy,
  t,
  onOpen,
  onRemove,
}: {
  file: File;
  index: number;
  busy: boolean;
  previewBusy: boolean;
  t: WorkItemsMessages;
  onOpen: (file: File) => void;
  onRemove: (index: number) => void;
}) {
  const mimeType = inferPreviewMimeType(file.name || 'upload', file.type || 'application/octet-stream');
  const previewable = isPreviewableFile(file.name || 'upload', mimeType);
  const thumbnailUrl = useObjectUrl(mimeType.startsWith('image/') ? file : null);

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-edge bg-surface-panel p-2 text-sm">
      <AttachmentPreviewThumb
        name={file.name || 'upload'}
        mimeType={mimeType}
        thumbnailUrl={thumbnailUrl}
        previewable={previewable}
        disabled={busy || previewBusy}
        onOpen={() => onOpen(file)}
      />
      <button
        type="button"
        className={cn(
          'min-w-0 flex-1 text-left',
          previewable ? 'rounded-md hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel' : 'cursor-default',
        )}
        disabled={!previewable || busy || previewBusy}
        onClick={() => onOpen(file)}
      >
        <div className="truncate font-medium text-fg">{file.name || 'upload'}</div>
        <div className="text-xs text-fg-subtle">{formatFileSize(file.size)}</div>
      </button>
      <button
        type="button"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
        title={t.attachments.remove}
        aria-label={t.attachments.remove}
        disabled={busy}
        onClick={() => onRemove(index)}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function SavedAttachmentRow({
  item,
  attachment,
  busy,
  previewBusy,
  t,
  onOpen,
  onDownload,
  onRemove,
}: {
  item: WorkItem;
  attachment: WorkItemAttachment;
  busy: boolean;
  previewBusy: boolean;
  t: WorkItemsMessages;
  onOpen: (item: WorkItem, attachment: WorkItemAttachment) => void;
  onDownload: (item: WorkItem, attachment: WorkItemAttachment) => void;
  onRemove: (item: WorkItem, attachment: WorkItemAttachment) => void;
}) {
  const previewable = isPreviewableFile(attachment.fileName, attachment.mimeType);
  const thumbnailUrl = useWorkItemAttachmentThumbnail(item.id, attachment);

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-edge bg-surface-panel p-2 text-sm">
      <AttachmentPreviewThumb
        name={attachment.fileName}
        mimeType={attachment.mimeType}
        thumbnailUrl={thumbnailUrl}
        previewable={previewable}
        disabled={busy || previewBusy}
        onOpen={() => onOpen(item, attachment)}
      />
      <button
        type="button"
        className={cn(
          'min-w-0 flex-1 text-left',
          previewable ? 'rounded-md hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel' : 'cursor-default',
        )}
        disabled={!previewable || busy || previewBusy}
        onClick={() => onOpen(item, attachment)}
      >
        <div className="truncate font-medium text-fg">{attachment.fileName}</div>
        <div className="truncate text-xs text-fg-subtle">{attachment.mimeType} · {formatFileSize(attachment.size)}</div>
      </button>
      <button
        type="button"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
        title={t.attachments.download}
        aria-label={t.attachments.download}
        disabled={busy}
        onClick={() => onDownload(item, attachment)}
      >
        <Download className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-danger"
        title={t.attachments.remove}
        aria-label={t.attachments.remove}
        disabled={busy}
        onClick={() => onRemove(item, attachment)}
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function WorkItemAttachmentsSection({
  mode,
  item,
  pendingFiles,
  busy,
  t,
  onPendingFilesChange,
  onUpload,
  onRemove,
  onDownload,
  onPreviewError,
}: {
  mode: 'create' | 'detail' | null;
  item: WorkItem | null;
  pendingFiles: File[];
  busy: boolean;
  t: WorkItemsMessages;
  onPendingFilesChange: (files: File[]) => void;
  onUpload: (item: WorkItem, files: File[]) => void;
  onRemove: (item: WorkItem, attachment: WorkItemAttachment) => void;
  onDownload: (item: WorkItem, attachment: WorkItemAttachment) => void;
  onPreviewError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activePreview, setActivePreview] = useState<MessageAttachment | null>(null);
  const [previewBusyKey, setPreviewBusyKey] = useState<string | null>(null);
  const authToken = useGatewayStore((state) => state.token);
  const savedAttachments = item?.attachments ?? [];

  function addFiles(files: File[]) {
    if (!files.length) return;
    if (mode === 'detail' && item) {
      onUpload(item, files);
      return;
    }
    const existing = new Set(pendingFiles.map(fileDedupeKey));
    const next = [...pendingFiles];
    for (const file of files) {
      const key = fileDedupeKey(file);
      if (existing.has(key)) continue;
      existing.add(key);
      next.push(file);
    }
    onPendingFilesChange(next);
  }

  function removePending(index: number) {
    onPendingFilesChange(pendingFiles.filter((_, fileIndex) => fileIndex !== index));
  }

  async function openPendingPreview(file: File) {
    const key = fileDedupeKey(file);
    setPreviewBusyKey(`pending:${key}`);
    try {
      setActivePreview(await fileToMessageAttachment(file, `pending:${key}`));
      setPreviewOpen(true);
    } catch (err) {
      onPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewBusyKey(null);
    }
  }

  async function openSavedPreview(targetItem: WorkItem, attachment: WorkItemAttachment) {
    setPreviewBusyKey(`saved:${attachment.id}`);
    try {
      const res = await apiFetch(workItemAttachmentContentUrl(targetItem.id, attachment.id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const content = arrayBufferToBase64(await res.arrayBuffer());
      setActivePreview(workItemAttachmentToMessageAttachment(attachment, content));
      setPreviewOpen(true);
    } catch (err) {
      onPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewBusyKey(null);
    }
  }

  return (
    <>
      <section
        className={cn(
          'grid gap-3 rounded-lg border border-edge bg-surface-base p-3',
          isDragging && 'border-accent bg-accent-soft/40',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
            <Paperclip className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <span className="truncate">{t.attachments.title}</span>
          </h3>
          <Button type="button" variant="secondary" className="h-8 rounded-lg px-2.5 text-xs" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Plus className="size-3.5" aria-hidden />
            {t.attachments.add}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.currentTarget.value = '';
            }}
          />
        </div>

        {pendingFiles.length ? (
          <div className="grid gap-2">
            {pendingFiles.map((file, index) => (
              <PendingAttachmentRow
                key={fileDedupeKey(file)}
                file={file}
                index={index}
                busy={busy}
                previewBusy={previewBusyKey === `pending:${fileDedupeKey(file)}`}
                t={t}
                onOpen={(target) => void openPendingPreview(target)}
                onRemove={removePending}
              />
            ))}
          </div>
        ) : null}

        {item && savedAttachments.length ? (
          <div className="grid gap-2">
            {savedAttachments.map((attachment) => (
              <SavedAttachmentRow
                key={attachment.id}
                item={item}
                attachment={attachment}
                busy={busy}
                previewBusy={previewBusyKey === `saved:${attachment.id}`}
                t={t}
                onOpen={(targetItem, targetAttachment) => void openSavedPreview(targetItem, targetAttachment)}
                onDownload={onDownload}
                onRemove={onRemove}
              />
            ))}
          </div>
        ) : null}

        {!pendingFiles.length && !savedAttachments.length ? (
          <p className="text-sm text-fg-muted">{t.attachments.empty}</p>
        ) : null}
      </section>
      <AttachmentPreviewDialog
        open={previewOpen}
        attachment={activePreview}
        authToken={authToken}
        layerClassName="z-[100]"
        onClose={() => {
          setPreviewOpen(false);
          setActivePreview(null);
        }}
      />
    </>
  );
}

function WorkItemModal({
  mode,
  item,
  detailReturnTo,
  initialStatus,
  events,
  busy,
  error,
  notice,
  t,
  onClose,
  onCreate,
  onSave,
  onStartChat,
  onCreateGoal,
  onAddAttachments,
  onRemoveAttachment,
  onDownloadAttachment,
  onPreviewError,
}: {
  mode: 'create' | 'detail' | null;
  item: WorkItem | null;
  detailReturnTo: string;
  initialStatus: WorkItemStatus;
  events: WorkItemEvent[];
  busy: boolean;
  error: string | null;
  notice: WorkItemNotice;
  t: WorkItemsMessages;
  onClose: () => void;
  onCreate: (input: { title: string; description?: string; priority: WorkItemPriority; status: WorkItemStatus; nextAction?: string; blockedReason?: string; attachments?: File[] }) => void;
  onSave: (item: WorkItem, patch: Parameters<typeof patchWorkItem>[1]) => void;
  onStartChat: (item: WorkItem) => void;
  onCreateGoal: (item: WorkItem) => void;
  onAddAttachments: (item: WorkItem, files: File[]) => void;
  onRemoveAttachment: (item: WorkItem, attachment: WorkItemAttachment) => void;
  onDownloadAttachment: (item: WorkItem, attachment: WorkItemAttachment) => void;
  onPreviewError: (message: string) => void;
}) {
  const open = mode !== null;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<WorkItemStatus>('todo');
  const [priority, setPriority] = useState<WorkItemPriority>('normal');
  const [nextAction, setNextAction] = useState('');
  const [blockedReason, setBlockedReason] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  useEffect(() => {
    if (mode === 'create') {
      setTitle('');
      setDescription('');
      setStatus(initialStatus);
      setPriority('normal');
      setNextAction('');
      setBlockedReason('');
      setPendingFiles([]);
      return;
    }
    if (mode === 'detail' && item) {
      setTitle(item.title);
      setDescription(item.description ?? '');
      setStatus(item.status);
      setPriority(item.priority);
      setNextAction(item.nextAction ?? '');
      setBlockedReason(item.blockedReason ?? '');
      setPendingFiles([]);
    }
  }, [initialStatus, item, mode]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    if (mode === 'create') {
      onCreate({
        title: trimmedTitle,
        description: description.trim() || undefined,
        priority,
        status,
        nextAction: nextAction.trim() || undefined,
        blockedReason: blockedReason.trim() || undefined,
        attachments: pendingFiles,
      });
      return;
    }
    if (!item) return;
    onSave(item, {
      title: trimmedTitle,
      description: description.trim() || null,
      status,
      priority,
      nextAction: nextAction.trim() || null,
      blockedReason: blockedReason.trim() || null,
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(86dvh,48rem)] w-[min(60rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
              <div className="min-w-0">
                <Dialog.Title className="truncate text-base font-semibold text-fg">
                  {mode === 'create' ? t.create.title : (item?.title || t.title)}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-fg-muted">{t.detail.description}</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg" disabled={busy}>
                  <X className="size-4" aria-hidden />
                </button>
              </Dialog.Close>
            </div>

            <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-5 py-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
              <div className="grid content-start gap-4">
                {error ? (
                  <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                    {error}
                  </div>
                ) : null}
                {!error && notice ? (
                  <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-fg" role="status" aria-live="polite">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <div className="min-w-0">
                      <div className="font-medium text-success">{notice.title}</div>
                      <div className="mt-1 text-fg-muted">{notice.message}</div>
                    </div>
                  </div>
                ) : null}
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg-muted">{t.create.titleLabel}</span>
                  <input
                    className="h-10 rounded-lg border border-edge bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm">
                    <span className="font-medium text-fg-muted">{t.detail.status}</span>
                    <Select className="h-10 rounded-lg border border-edge bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent" value={status} onChange={(event) => setStatus(event.target.value as WorkItemStatus)}>
                      {BOARD_COLUMNS.map((value) => <SelectOption key={value} value={value}>{t.statuses[value]}</SelectOption>)}
                    </Select>
                  </label>
                  <label className="grid gap-1.5 text-sm">
                    <span className="font-medium text-fg-muted">{t.create.priorityLabel}</span>
                    <Select className="h-10 rounded-lg border border-edge bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent" value={priority} onChange={(event) => setPriority(event.target.value as WorkItemPriority)}>
                      {PRIORITIES.map((value) => <SelectOption key={value} value={value}>{t.priorities[value]}</SelectOption>)}
                    </Select>
                  </label>
                </div>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg-muted">{t.create.descriptionLabel}</span>
                  <textarea className="min-h-28 rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent" value={description} onChange={(event) => setDescription(event.target.value)} />
                </label>
                <WorkItemAttachmentsSection
                  mode={mode}
                  item={item}
                  pendingFiles={pendingFiles}
                  busy={busy}
                  t={t}
                  onPendingFilesChange={setPendingFiles}
                  onUpload={onAddAttachments}
                  onRemove={onRemoveAttachment}
                  onDownload={onDownloadAttachment}
                  onPreviewError={onPreviewError}
                />
                {mode === 'detail' ? (
                  <>
                    <label className="grid gap-1.5 text-sm">
                      <span className="font-medium text-fg-muted">{t.nextAction}</span>
                      <textarea className="min-h-20 rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent" value={nextAction} onChange={(event) => setNextAction(event.target.value)} />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                      <span className={cn('font-medium', status === 'blocked' || status === 'needs_input' ? 'text-red-700 dark:text-red-300' : 'text-fg-muted')}>{t.blockedReason}</span>
                      <textarea className={cn('min-h-20 rounded-lg border bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent', status === 'blocked' || status === 'needs_input' ? 'border-red-500/40' : 'border-edge')} value={blockedReason} onChange={(event) => setBlockedReason(event.target.value)} />
                    </label>
                  </>
                ) : null}
              </div>

              <aside className="grid content-start gap-5">
                {mode === 'detail' && item ? (
                  <section>
                    <h3 className="text-sm font-semibold text-fg">{t.detail.actions}</h3>
                    <div className="mt-2 grid gap-2">
                      <Button type="button" variant="secondary" className="justify-start rounded-lg" disabled={busy} onClick={() => onStartChat(item)}>
                        <MessageSquarePlus className="size-4" aria-hidden />
                        {t.detail.startChat}
                      </Button>
                      <Button type="button" variant="secondary" className="justify-start rounded-lg" disabled={busy} onClick={() => onCreateGoal(item)}>
                        <Target className="size-4" aria-hidden />
                        {t.detail.createGoal}
                      </Button>
                      <Button asChild variant="secondary" className="justify-start rounded-lg">
                        <Link to={withReturnTo(`/work-items/${encodeURIComponent(item.id)}`, detailReturnTo)}>
                          <ExternalLink className="size-4" aria-hidden />
                          {t.detail.openItem}
                        </Link>
                      </Button>
                    </div>
                  </section>
                ) : null}

                <section>
                  <h3 className="text-sm font-semibold text-fg">{t.detail.links}</h3>
                  <div className="mt-2 grid gap-2 text-sm">
                    {item?.links?.length ? item.links.slice(0, 6).map((link) => (
                      <Link key={link.id} to={linkHref(link)} className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover">
                        <span className="min-w-0 truncate text-fg">{link.title || link.targetId}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted">
                          {t.linkKinds[link.kind]}
                          <ExternalLink className="size-3.5" aria-hidden />
                        </span>
                      </Link>
                    )) : <p className="text-sm text-fg-muted">{t.detail.noLinks}</p>}
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-fg">{t.detail.activity}</h3>
                  <div className="mt-2 grid gap-2">
                    {events.length ? events.slice(0, 5).map((event) => (
                      <div key={event.id} className="text-sm">
                        <div className="font-medium text-fg">{t.eventTypes[event.type] ?? event.type}</div>
                        <div className="mt-0.5 text-xs text-fg-subtle">{formatTime(event.createdAt)}</div>
                      </div>
                    )) : <p className="text-sm text-fg-muted">{t.detail.noActivity}</p>}
                  </div>
                </section>
              </aside>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
              <Button type="button" variant="ghost" className="rounded-lg" onClick={onClose} disabled={busy}>{t.create.cancel}</Button>
              <Button type="submit" variant="primary" className="rounded-lg" disabled={busy || !title.trim()}>
                {mode === 'create' ? <Plus className="size-4" aria-hidden /> : null}
                {mode === 'create' ? t.create.submit : t.detail.save}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WorkItemsPanel({
  projectId,
  createRequestKey = 0,
  detailReturnTo,
}: {
  projectId: string;
  createRequestKey?: number;
  detailReturnTo: string;
}) {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).projectDetailPage.workItems;
  const boardScrollerRef = useRef<HTMLDivElement | null>(null);
  const boardPanRef = useRef<BoardPanState | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<WorkItemNotice>(null);
  const [busy, setBusy] = useState(false);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState<WorkItemStatus | null>(null);
  const [isPanningBoard, setIsPanningBoard] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStatus, setCreateStatus] = useState<WorkItemStatus>('todo');
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<WorkItemEvent[]>([]);

  const loadItems = useCallback(async (mode: 'replace' | 'append' = 'replace', offset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchProjectWorkItems(projectId, {
        limit: 100,
        offset,
      });
      setItems((current) => mode === 'append' ? [...current, ...res.items] : res.items);
      setHasMore(res.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadItems('replace', 0);
  }, [loadItems]);

  useEffect(() => {
    if (!createRequestKey) return;
    setSelectedItem(null);
    setSelectedEvents([]);
    setError(null);
    setNotice(null);
    setCreateStatus('todo');
    setCreateOpen(true);
  }, [createRequestKey]);

  const boardColumns = useMemo(() => BOARD_COLUMNS.map((status) => ({
    status,
    title: t.statuses[status],
    items: items.filter((item) => item.status === status),
  })), [items, t.statuses]);

  const updateLocalItem = useCallback((next: WorkItem) => {
    setItems((current) => current.map((item) => item.id === next.id ? next : item));
    setSelectedItem((current) => current?.id === next.id ? next : current);
  }, []);

  const updateItem = useCallback(async (item: WorkItem, patch: Parameters<typeof patchWorkItem>[1]) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await patchWorkItem(item.id, patch);
      if (res.item.archivedAt) {
        setItems((current) => current.filter((candidate) => candidate.id !== res.item.id));
        setSelectedItem(null);
      } else {
        updateLocalItem(res.item);
        const nextNotice = { title: t.feedback.savedTitle, message: t.feedback.savedNext };
        setNotice(nextNotice);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [t.feedback.savedNext, t.feedback.savedTitle, updateLocalItem]);

  const openItem = useCallback(async (item: WorkItem) => {
    setSelectedItem(item);
    setSelectedEvents([]);
    setError(null);
    setNotice(null);
    const res = await fetchWorkItemEvents(item.id).catch(() => null);
    if (res) setSelectedEvents(res.events);
  }, []);

  const createItem = useCallback(async (input: { title: string; description?: string; priority: WorkItemPriority; status: WorkItemStatus; nextAction?: string; blockedReason?: string; attachments?: File[] }) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await createWorkItem(projectId, input);
      setItems((current) => [res.item, ...current]);
      setCreateOpen(false);
      setSelectedItem(res.item);
      const events = await fetchWorkItemEvents(res.item.id).catch(() => ({ events: [] }));
      setSelectedEvents(events.events);
      const nextNotice = { title: t.feedback.createdTitle, message: t.feedback.createdNext };
      setNotice(nextNotice);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [projectId, t.feedback.createdNext, t.feedback.createdTitle]);

  const addAttachments = useCallback(async (item: WorkItem, files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await uploadWorkItemAttachments(item.id, files);
      updateLocalItem(res.item);
      const events = await fetchWorkItemEvents(res.item.id).catch(() => ({ events: [] }));
      setSelectedEvents(events.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [updateLocalItem]);

  const removeAttachment = useCallback(async (item: WorkItem, attachment: WorkItemAttachment) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await deleteWorkItemAttachment(item.id, attachment.id);
      updateLocalItem(res.item);
      const events = await fetchWorkItemEvents(res.item.id).catch(() => ({ events: [] }));
      setSelectedEvents(events.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [updateLocalItem]);

  const downloadAttachment = useCallback(async (item: WorkItem, attachment: WorkItemAttachment) => {
    setError(null);
    setNotice(null);
    try {
      await downloadWorkItemAttachment(item.id, attachment);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const startChat = useCallback(async (item: WorkItem) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await startWorkItemChat(item.id);
      updateLocalItem(res.item);
      await openItem(res.item);
      navigate(`/chat/${encodeURIComponent(res.session.key)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [navigate, openItem, updateLocalItem]);

  const createGoal = useCallback(async (item: WorkItem) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await createWorkItemGoal(item.id);
      updateLocalItem(res.item);
      await openItem(res.item);
      navigate(withReturnTo(`/goals/${encodeURIComponent(res.goal.id)}`, detailReturnTo));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detailReturnTo, navigate, openItem, updateLocalItem]);

  const startDrag = useCallback((item: WorkItem, event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_TYPE, item.id);
    setDraggingItemId(item.id);
  }, []);

  const dropOnStatus = useCallback((targetStatus: WorkItemStatus, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const itemId = event.dataTransfer.getData(DRAG_TYPE) || draggingItemId;
    setDropStatus(null);
    setDraggingItemId(null);
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item || item.status === targetStatus) return;
    void updateItem(item, { status: targetStatus });
  }, [draggingItemId, items, updateItem]);

  const toggleDone = useCallback((item: WorkItem) => {
    void updateItem(item, { status: item.status === 'done' ? 'todo' : 'done' });
  }, [updateItem]);

  const openCreateForStatus = useCallback((status: WorkItemStatus) => {
    setSelectedItem(null);
    setSelectedEvents([]);
    setError(null);
    setNotice(null);
    setCreateStatus(status);
    setCreateOpen(true);
  }, []);

  const endBoardPan = useCallback((event: PointerEvent<HTMLElement>) => {
    const pan = boardPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    boardPanRef.current = null;
    setIsPanningBoard(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleBoardPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || draggingItemId || shouldIgnoreBoardPan(event.target)) return;
    const scroller = boardScrollerRef.current;
    if (!scroller) return;
    boardPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: scroller.scrollLeft,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [draggingItemId]);

  const handleBoardPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const pan = boardPanRef.current;
    const scroller = boardScrollerRef.current;
    if (!pan || !scroller || pan.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pan.startX;
    if (!pan.active && Math.abs(deltaX) < 5) return;
    if (!pan.active) {
      pan.active = true;
      setIsPanningBoard(true);
    }
    event.preventDefault();
    scroller.scrollLeft = pan.scrollLeft - deltaX;
  }, []);

  return (
    <section id="project-panel-work-items" role="tabpanel" aria-labelledby="project-tab-work-items" className="flex h-full min-h-0 flex-col">
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div> : null}

      <section
        ref={boardScrollerRef}
        className={cn(
          'min-h-0 flex-1 overflow-x-auto rounded-lg p-2 transition-opacity',
          loading && 'opacity-60',
          isPanningBoard ? 'cursor-grabbing select-none' : 'cursor-grab',
        )}
        aria-label={t.boardAria}
        aria-busy={loading}
        onPointerDown={handleBoardPointerDown}
        onPointerMove={handleBoardPointerMove}
        onPointerUp={endBoardPan}
        onPointerCancel={endBoardPan}
        onLostPointerCapture={(event) => {
          if (boardPanRef.current?.pointerId === event.pointerId) {
            boardPanRef.current = null;
            setIsPanningBoard(false);
          }
        }}
      >
          <div className="flex min-h-full min-w-max items-start gap-3 pr-4">
            {boardColumns.map((column) => (
              <section
                key={column.status}
                className={cn(
                  'flex max-h-full w-72 min-w-72 max-w-72 shrink-0 flex-col overflow-y-auto rounded-lg bg-surface-base shadow-surface',
                  dropStatus === column.status && 'bg-surface-active',
                )}
                aria-label={column.title}
                onDragOver={(event) => {
                  if (!draggingItemId) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropStatus(column.status);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropStatus(null);
                }}
                onDrop={(event) => dropOnStatus(column.status, event)}
              >
                <header className="flex shrink-0 items-center justify-between gap-2 p-3">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <h3 className="truncate text-sm font-semibold text-fg">{column.title}</h3>
                    <span className="shrink-0 text-xs text-fg-subtle">{column.items.length}</span>
                  </div>
                  <MoreHorizontal className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                </header>
                <div className="mx-2 mt-3 grid min-h-0 min-w-0 content-start gap-2 pb-2 pr-1 [scrollbar-gutter:stable]">
                  {column.items.length ? column.items.map((item) => (
                    <WorkItemCard
                      key={item.id}
                      item={item}
                      detailReturnTo={detailReturnTo}
                      dragging={draggingItemId === item.id}
                      onOpen={openItem}
                      onToggleDone={toggleDone}
                      onDragStart={startDrag}
                      onDragEnd={() => {
                        setDraggingItemId(null);
                        setDropStatus(null);
                      }}
                      t={t}
                    />
                  )) : loading ? (
                    <div className="grid gap-2 animate-pulse motion-reduce:animate-none">
                      <WorkItemCardSkeleton />
                      <WorkItemCardSkeleton />
                    </div>
                  ) : (
                    <div className="rounded-lg bg-surface-panel/70 px-3 py-6 text-center text-xs text-fg-subtle">
                      {t.emptyColumn}
                    </div>
                  )}
                  {!loading ? (
                    <button
                      type="button"
                      className="inline-flex h-8 w-full items-center justify-center rounded-lg bg-surface-panel/85 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-muted"
                      aria-label={t.create.addToColumn.replace('{{status}}', column.title)}
                      title={t.create.addToColumn.replace('{{status}}', column.title)}
                      onClick={() => openCreateForStatus(column.status)}
                    >
                      <Plus className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
      </section>

      {!loading && hasMore ? (
        <Button type="button" variant="secondary" className="justify-self-center" onClick={() => void loadItems('append', items.length)}>
          {t.loadMore}
        </Button>
      ) : null}

      <WorkItemModal
        mode={createOpen ? 'create' : selectedItem ? 'detail' : null}
        item={selectedItem}
        detailReturnTo={detailReturnTo}
        initialStatus={createStatus}
        events={selectedEvents}
        busy={busy}
        error={error}
        notice={notice}
        t={t}
        onClose={() => {
          setCreateOpen(false);
          setSelectedItem(null);
          setSelectedEvents([]);
          setError(null);
          setNotice(null);
        }}
        onCreate={createItem}
        onSave={(item, patch) => void updateItem(item, patch)}
        onStartChat={startChat}
        onCreateGoal={createGoal}
        onAddAttachments={(item, files) => void addAttachments(item, files)}
        onRemoveAttachment={(item, attachment) => void removeAttachment(item, attachment)}
        onDownloadAttachment={(item, attachment) => void downloadAttachment(item, attachment)}
        onPreviewError={(message) => {
          setNotice(null);
          setError(message);
        }}
      />
    </section>
  );
}
