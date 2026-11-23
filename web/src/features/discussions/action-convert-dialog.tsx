import * as Dialog from '@radix-ui/react-dialog';
import { CheckSquare, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { listNoteProjects } from '@/features/notes/notes-api';
import { useGatewayStore } from '@/stores/gateway-store';

export interface ActionConvertDraft {
  actionId: string;
  title: string;
  owner?: string;
  dueDate?: string;
  projectId?: string;
  evidencePreview?: string;
}

export interface ActionConvertDialogProps {
  initial: ActionConvertDraft;
  zh: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (overrides: {
    title: string;
    owner: string;
    dueDate: string;
    projectId: string | null;
  }) => Promise<void>;
}

export function ActionConvertDialog({
  initial,
  zh,
  busy,
  onClose,
  onConfirm,
}: ActionConvertDialogProps) {
  const token = useGatewayStore((s) => s.conversationId);
  const { data: projectData, isLoading: projectsLoading } = useSWR(
    token ? ['action-convert-projects', token] : null,
    listNoteProjects,
  );
  const projects = projectData?.items ?? [];

  const [title, setTitle] = useState(initial.title);
  const [owner, setOwner] = useState(initial.owner ?? '');
  const [dueDate, setDueDate] = useState(initial.dueDate ?? '');
  const [projectId, setProjectId] = useState(initial.projectId ?? '');
  const [projectSearch, setProjectSearch] = useState('');

  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[70] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="xopc-dialog-content fixed left-1/2 top-1/2 z-[71] flex h-[min(32rem,calc(100dvh-2rem))] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-popover focus:outline-none"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-4">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-fg">
              <CheckSquare className="size-4 text-accent-fg" aria-hidden />
              <span>{zh ? '确认并创建任务' : 'Confirm & Create Task'}</span>
            </Dialog.Title>
            <button
              type="button"
              disabled={busy}
              aria-label={zh ? '关闭' : 'Close'}
              onClick={onClose}
              className="rounded-md p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <label className="block text-xs font-medium text-fg-muted">
              {zh ? '任务标题' : 'Task title'}
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={zh ? '输入清晰可执行的任务标题' : 'Actionable task title'}
                className="mt-1.5 h-9 w-full rounded-lg border border-edge bg-surface-panel px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-fg-muted">
                {zh ? '负责人备注（可选）' : 'Owner / Assignee note'}
                <input
                  type="text"
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  placeholder={zh ? '例如：张三' : 'e.g. Alice'}
                  className="mt-1.5 h-9 w-full rounded-lg border border-edge bg-surface-panel px-3 text-sm text-fg outline-none focus:border-accent"
                />
              </label>

              <label className="block text-xs font-medium text-fg-muted">
                {zh ? '截止时间 / 节点（可选）' : 'Due date / Milestone'}
                <input
                  type="text"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  placeholder={zh ? '例如：本周五 / 2026-12-01' : 'e.g. Friday / 2026-12-01'}
                  className="mt-1.5 h-9 w-full rounded-lg border border-edge bg-surface-panel px-3 text-sm text-fg outline-none focus:border-accent"
                />
              </label>
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-medium text-fg-muted">
                {zh ? '归属项目' : 'Project'}
              </span>
              <PopoverSelect
                value={projectId}
                allowEmpty
                emptyLabel={zh ? '不归属特定项目（收件箱）' : 'No project (Inbox)'}
                ariaLabel={zh ? '归属项目' : 'Project'}
                placeholder={zh ? '不归属特定项目（收件箱）' : 'No project (Inbox)'}
                selectedLabel={
                  selectedProject?.name ?? (zh ? '不归属特定项目（收件箱）' : 'No project (Inbox)')
                }
                options={projects
                  .filter((p) => p.name.toLowerCase().includes(projectSearch.toLowerCase()))
                  .map((p) => ({ value: p.id, label: p.name }))}
                loading={projectsLoading}
                searchPlaceholder={zh ? '搜索项目…' : 'Search projects…'}
                searchValue={projectSearch}
                onSearchChange={setProjectSearch}
                triggerClassName="h-9 w-full bg-surface-panel text-xs"
                onChange={(next) => setProjectId(next)}
              />
            </div>

            {initial.evidencePreview ? (
              <div className="rounded-lg border border-edge-subtle bg-surface-inset p-3 text-xs leading-5 text-fg-muted">
                <div className="mb-1 font-medium text-fg-subtle">
                  {zh ? '会议原话依据' : 'Meeting transcript context'}
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap">{initial.evidencePreview}</p>
              </div>
            ) : null}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-edge px-5 py-3">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              {zh ? '取消' : 'Cancel'}
            </Button>
            <Button
              variant="primary"
              disabled={busy || !title.trim()}
              onClick={() =>
                void onConfirm({
                  title: title.trim(),
                  owner: owner.trim(),
                  dueDate: dueDate.trim(),
                  projectId: projectId || null,
                })
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              <span>{zh ? '确认创建任务' : 'Create task'}</span>
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
