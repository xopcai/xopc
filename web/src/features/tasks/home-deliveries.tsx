import * as Dialog from '@radix-ui/react-dialog';
import type { HomeDelivery } from '@xopcai/gateway-contract';
import { ChevronRight, FileText, X } from 'lucide-react';
import { lazy, Suspense, useRef, useState } from 'react';
import useSWR from 'swr';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { automationApi } from '@/features/automations/automation-api';
import { messages } from '@/i18n/messages';
import { formatMediumDateTime } from '@/lib/date-formatters';

import { fetchTask } from './home-api';
import { TaskExpandableContent } from './task-expandable-content';
import { TaskResultEvidence } from './task-result-evidence';

const WorkspaceFilePreviewPanel = lazy(() => import('@/features/workspace/workspace-file-preview-dialog')
  .then((module) => ({ default: module.WorkspaceFilePreviewPanel })));

export function HomeDeliveryRow({ item, language, primary, showNew = false, onOpen }: {
  item: HomeDelivery;
  language: 'zh' | 'en';
  primary?: boolean;
  showNew?: boolean;
  onOpen: () => void;
}) {
  const copy = messages(language).projectsPage.home.workbench;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 basis-48 items-start gap-3">
        {showNew ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-inset text-fg-muted">
            <FileText className="size-4" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-fg">{item.title}</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {showNew ? <span className="mr-2 font-medium text-accent-fg">{copy.newDelivery}</span> : null}
            <time dateTime={new Date(item.completedAt).toISOString()}>{formatMediumDateTime(new Date(item.completedAt), language)}</time>
          </p>
          {item.summary ? <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-fg-muted">{item.summary}</p> : null}
        </div>
      </div>
      <Button variant={primary ? 'primary' : showNew ? 'ghost' : 'secondary'} className="min-h-9 shrink-0 gap-1 rounded-lg px-2.5 text-xs sm:shadow-none" onClick={onOpen}>
        {copy.openDelivery}{showNew ? <ChevronRight className="size-3.5" aria-hidden /> : null}
      </Button>
    </div>
  );
}

export function HomeDeliveriesDialog({ view, items, language, onSelect, onClose, onRead, onOpenFull, onRestoreFocus }: {
  view: HomeDelivery | 'history' | null;
  items: HomeDelivery[];
  language: 'zh' | 'en';
  onSelect: (item: HomeDelivery) => void;
  onClose: () => void;
  onRead: (item: HomeDelivery) => void;
  onOpenFull: (item: HomeDelivery) => void;
  onRestoreFocus: () => void;
}) {
  const copy = messages(language).projectsPage.home;
  const [marking, setMarking] = useState(false);
  const [readError, setReadError] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const pending = useRef(false);
  const selected = view && view !== 'history' ? view : null;
  const { data: result, error, mutate } = useSWR(selected ? ['home-delivery', selected.id] : null, async () => {
    if (!selected) return;
    if (selected.kind === 'automation') {
      const { run } = await automationApi.getRun(selected.subjectId);
      return { kind: 'automation' as const, summary: run.summary };
    }
    const detail = await fetchTask(selected.subjectId);
    const receipt = detail.receipts.find((item) => `task:${item.runId}` === selected.id);
    if (!receipt) throw new Error(copy.workbench.deliveryFailed);
    return { kind: 'task' as const, detail, receipt };
  }, { shouldRetryOnError: false });
  const canMark = result?.kind === 'task' || Boolean(result?.summary?.trim());

  async function finish(item: HomeDelivery) {
    if (pending.current) return;
    pending.current = true;
    setMarking(true);
    setReadError(false);
    try {
      if (item.kind === 'automation' && !item.read) await automationApi.markRunRead(item.subjectId);
      onRead(item);
    } catch {
      setReadError(true);
    } finally {
      pending.current = false;
      setMarking(false);
    }
  }

  return (
    <Dialog.Root open={view !== null} onOpenChange={(open) => {
      if (!open && !pending.current) { setReadError(false); onClose(); }
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim" />
        <Dialog.Content
          className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(36rem,calc(100dvh-2rem))] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay outline-none"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus(); }}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 py-3">
            <Dialog.Title className="truncate text-base font-semibold text-fg">{selected?.title ?? copy.workbench.deliveryHistory}</Dialog.Title>
            <Dialog.Close asChild><Button variant="ghost" className="size-9 p-0" disabled={marking} aria-label={language === 'zh' ? '关闭' : 'Close'}><X className="size-4" /></Button></Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {view === 'history' ? (
              items.length ? <div className="divide-y divide-edge-subtle">{items.map((item) => <HomeDeliveryRow key={item.id} item={item} language={language} onOpen={() => { setReadError(false); onSelect(item); }} />)}</div>
                : <p className="text-sm text-fg-muted">{copy.workbench.deliveryEmpty}</p>
            ) : error ? (
              <div role="alert" className="space-y-2 text-sm text-danger"><p>{copy.workbench.deliveryFailed}</p><Button variant="secondary" onClick={() => void mutate()}>{copy.retry}</Button></div>
            ) : !result ? (
              <div className="space-y-3" aria-busy><Skeleton className="h-5 w-2/3" /><Skeleton className="h-24" /></div>
            ) : result.kind === 'task' ? (
              <>
                <TaskExpandableContent content={result.receipt.summary} contentKey={result.receipt.runId} language={language} />
                <TaskResultEvidence
                  evidence={result.receipt.evidence}
                  projectId={result.detail.task.projectId}
                  conversationId={result.detail.conversation.activeConversationId ?? undefined}
                  language={language}
                  onOpenFile={setPreviewPath}
                />
                <Dialog.Root open={previewPath !== null} onOpenChange={(open) => { if (!open) setPreviewPath(null); }}>
                  <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[90] bg-scrim" />
                    <Dialog.Content className="fixed left-1/2 top-1/2 z-[100] flex h-[min(54rem,calc(100dvh-2rem))] w-[min(72rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel outline-none" aria-describedby={undefined}>
                      <Dialog.Title className="sr-only">{previewPath}</Dialog.Title>
                      <Suspense fallback={<Skeleton className="m-4 min-h-24" />}>
                        <WorkspaceFilePreviewPanel filePath={previewPath} projectId={result.detail.task.projectId} conversationId={result.detail.conversation.activeConversationId} onClose={() => setPreviewPath(null)} />
                      </Suspense>
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>
              </>
            ) : result.kind === 'automation' && result.summary ? (
              <MarkdownView content={result.summary} />
            ) : <p className="text-sm text-fg-muted">{copy.workbench.noSummary}</p>}
          </div>
          {selected ? (
            <footer className="shrink-0 space-y-2 border-t border-edge px-4 py-3">
              {readError ? <p role="alert" className="text-sm text-danger">{copy.workbench.readFailed}</p> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={marking} onClick={() => onOpenFull(selected)}>{copy.workbench.openFullResult}</Button>
                <Button variant="primary" disabled={Boolean(error) || !canMark || marking} onClick={() => void finish(selected)}>{copy.workbench.markRead}</Button>
              </div>
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
