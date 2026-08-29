import * as Dialog from '@radix-ui/react-dialog';
import { Check, FileText, ListChecks, Plus, X } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { listNotes } from '@/features/notes/notes-api';
import { fetchProjectOperatingView } from '@/features/projects/api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowRunContextRef } from './workflow-api';

export function WorkflowContextPicker({ projectId, language, value, onChange }: {
  projectId?: string;
  language: StoredLanguage;
  value: WorkflowRunContextRef[];
  onChange: (next: WorkflowRunContextRef[]) => void;
}) {
  const labels = messages(language).workflows;
  const taskStates = messages(language).projectDetailPage.board.operationalStates;
  const project = useSWR(projectId ? ['workflow-context-project', projectId] : null, () => fetchProjectOperatingView(projectId!), { revalidateOnFocus: false });
  const notes = useSWR(projectId ? ['workflow-context-notes', projectId] : null, () => listNotes({ projectId, limit: 100, sortBy: 'updatedAt', sortOrder: 'desc' }), { revalidateOnFocus: false });
  const toggle = (ref: WorkflowRunContextRef) => {
    const active = value.some((item) => item.kind === ref.kind && item.id === ref.id);
    onChange(active ? value.filter((item) => item.kind !== ref.kind || item.id !== ref.id) : [...value, ref]);
  };

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button type="button" variant="secondary" className="h-9 w-full justify-between rounded-lg px-3 text-xs" disabled={!projectId}>
          <span>{labels.contextPickerLabel}</span>
          <span className="flex items-center gap-1 text-fg-muted">
            {value.length ? labels.contextPickerCount.replace('{{count}}', String(value.length)) : labels.contextPickerEmpty}
            <Plus className="size-3.5" aria-hidden />
          </span>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(42rem,calc(100vh-2rem))] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-base shadow-xl">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">{labels.contextPickerTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-fg-muted">{labels.contextPickerDescription}</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button type="button" variant="ghost" className="size-8 p-0" aria-label={labels.pickStartClose}><X className="size-4" /></Button></Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {(project.isLoading || notes.isLoading) ? (
              <div className="grid gap-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-14 rounded-xl" />)}</div>
            ) : (project.error || notes.error) ? (
              <p className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{labels.contextPickerLoadFailed}</p>
            ) : (
              <div className="space-y-6">
                <ContextGroup title={labels.contextTasks} icon={ListChecks} empty={labels.contextTasksEmpty} items={(project.data?.tasks ?? []).map((task) => ({ id: task.id, title: task.title, subtitle: taskStates[task.operationalState] }))} selected={value} kind="task" onToggle={toggle} />
                <ContextGroup title={labels.contextNotes} icon={FileText} empty={labels.contextNotesEmpty} items={(notes.data?.items ?? []).map((note) => ({ id: note.id, title: note.title || labels.contextUntitled, subtitle: note.snippet }))} selected={value} kind="note" onToggle={toggle} />
              </div>
            )}
          </div>
          <footer className="flex shrink-0 items-center justify-between border-t border-edge px-5 py-3">
            <span className="text-xs text-fg-muted">{labels.contextPickerCount.replace('{{count}}', String(value.length))}</span>
            <Dialog.Close asChild><Button type="button" variant="primary" className="h-9">{labels.contextPickerDone}</Button></Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ContextGroup({ title, icon: Icon, empty, items, selected, kind, onToggle }: {
  title: string;
  icon: typeof ListChecks;
  empty: string;
  items: Array<{ id: string; title: string; subtitle?: string }>;
  selected: WorkflowRunContextRef[];
  kind: 'task' | 'note';
  onToggle: (ref: WorkflowRunContextRef) => void;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><Icon className="size-4 text-fg-subtle" aria-hidden />{title}</h3>
      {items.length ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {items.map((item) => {
            const active = selected.some((ref) => ref.kind === kind && ref.id === item.id);
            return (
              <button key={item.id} type="button" className={cn('flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left', active ? 'border-accent bg-accent-soft' : 'border-edge-subtle hover:bg-surface-hover')} aria-pressed={active} onClick={() => onToggle({ kind, id: item.id, role: kind === 'task' ? 'objective' : 'reference', title: item.title })}>
                <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border', active ? 'border-accent bg-accent text-white' : 'border-edge')}>{active ? <Check className="size-3.5" aria-hidden /> : null}</span>
                <span className="min-w-0"><strong className="block truncate text-sm font-medium text-fg">{item.title}</strong>{item.subtitle ? <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted">{item.subtitle}</span> : null}</span>
              </button>
            );
          })}
        </div>
      ) : <p className="mt-2 text-xs text-fg-muted">{empty}</p>}
    </section>
  );
}
