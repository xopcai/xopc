import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { startTransition, useCallback, useEffect, useRef, useState, type ComponentProps, type CSSProperties, type RefObject } from 'react';

import { TaskDetailSkeleton } from '@/features/tasks/task-detail-skeleton';
import { TaskHeaderTitle } from '@/features/tasks/task-header-title';
import { useTaskDetailQuery } from '@/features/tasks/use-task-detail';
import { loadTaskDetailPage } from '@/lib/route-preload';
import type { TaskDetailView, TaskHeaderState } from '@/pages/task-detail-page';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

function TaskDetailModalBody({ contentRef, ...props }: ComponentProps<typeof TaskDetailView> & {
  contentRef: RefObject<HTMLDivElement | null>;
}) {
  const [body, setBody] = useState<{ View: typeof TaskDetailView } | { error: unknown }>();

  useEffect(() => {
    const entrance = contentRef.current?.getAnimations?.().find(
      (animation) => 'animationName' in animation && animation.animationName === 'task-detail-enter',
    );
    let mounted = true;
    // Cancellation also releases the body when the user enables reduced motion mid-animation.
    const finished = entrance?.finished.catch(() => undefined);
    void Promise.all([loadTaskDetailPage(), finished]).then(
      ([{ TaskDetailView: View }]) => {
        if (mounted) startTransition(() => setBody({ View }));
      },
      (error: unknown) => {
        if (mounted) setBody({ error });
      },
    );
    return () => { mounted = false; };
  }, [contentRef]);

  if (!body) return <div className="p-5"><TaskDetailSkeleton /></div>;
  if ('error' in body) throw body.error;
  const { View } = body;
  return <View key={props.taskId} {...props} />;
}

export function TaskDetailModal({ taskId, backgroundPath, initialTitle, workspacePanelWidth = 0, onClose }: {
  taskId: string;
  backgroundPath: string;
  initialTitle?: string;
  workspacePanelWidth?: number;
  onClose: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const setPreviewPath = useWorkspacePreviewStore((state) => state.setPath);
  const workspacePanelOpen = workspacePanelWidth > 0;
  const [header, setHeader] = useState<TaskHeaderState>();
  const contentRef = useRef<HTMLDivElement>(null);
  const currentHeader = header?.taskId === taskId ? header : undefined;

  useTaskDetailQuery(taskId, { revalidateOnFocus: true });

  const close = useCallback(() => {
    setPreviewPath(null);
    onClose();
  }, [onClose, setPreviewPath]);

  return (
    <Dialog.Root
      modal={false}
      open
      onOpenChange={(open) => { if (!open) close(); }}
    >
      <Dialog.Portal>
        <button
          type="button"
          tabIndex={-1}
          data-task-modal-backdrop
          className="task-detail-modal-backdrop fixed inset-0 z-[80] bg-black/45"
          aria-label={language === 'zh' ? '关闭任务详情' : 'Close task details'}
          onClick={close}
        />
        <Dialog.Content
          ref={contentRef}
          className="xopc-dialog-content task-detail-modal-content fixed top-1/2 z-[90] flex h-[min(54rem,calc(100dvh-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay focus:outline-none"
          data-workspace-panel-open={workspacePanelOpen ? 'true' : 'false'}
          style={{
            '--task-detail-workspace-offset': `${workspacePanelWidth / 2}px`,
            '--task-detail-workspace-width': `${workspacePanelWidth}px`,
          } as CSSProperties}
          onEscapeKeyDown={(event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.closest('[data-task-inline-editor]')) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            const target = event.detail.originalEvent.target;
            if (
              target instanceof Element
              && target.closest('#app-workspace-panel, [data-task-modal-backdrop]')
            ) event.preventDefault();
          }}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 bg-surface-panel px-5 py-3.5">
            <Dialog.Title className="min-w-0 flex-1 font-medium text-fg">
              <TaskHeaderTitle label={(!currentHeader?.title && initialTitle) || (language === 'zh' ? '任务详情' : 'Task details')} title={currentHeader?.title} compact={currentHeader?.compact ?? false} />
            </Dialog.Title>
            <Dialog.Description className="sr-only">{language === 'zh' ? '查看并操作任务详情' : 'View and manage task details'}</Dialog.Description>
            <div className="flex shrink-0 items-center gap-1">
              <Dialog.Close className="flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={language === 'zh' ? '关闭任务详情' : 'Close task details'}><X className="size-4" aria-hidden /></Dialog.Close>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">
            <TaskDetailModalBody contentRef={contentRef} taskId={taskId} presentation="modal" backgroundPath={backgroundPath} onHeaderChange={setHeader} onDeleted={close} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
