import * as Popover from '@radix-ui/react-popover';
import type { SessionContextSource } from '@xopcai/gateway-contract';
import { ChevronDown, FileText, FolderKanban, GitBranch, ListFilter, RefreshCw, Target } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import type { ComposerContextRef } from '@/features/chat/composer/composer.types';
import { ChatWorkspaceControl } from '@/features/chat/workspace/chat-workspace-control';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { withDetailReturnTo } from '@/lib/navigation-return';
import { useLocaleStore } from '@/stores/locale-store';

import { sessionContextCopy } from './session-context-copy';
import { useSessionContext } from './use-session-context';

export interface SessionContextPanelProps {
  sessionKey: string | null;
  draftRefs?: ComposerContextRef[];
  canChangeWorkspace?: boolean;
  workspaceDisabled?: boolean;
  onWorkspaceChange?: (path: string) => Promise<void>;
  project?: { id: string; name: string } | null;
  onLeaveProject?: () => void;
  leaveProjectLabel?: string;
  onDraftSourceNote?: () => void;
  draftSourceNoteLabel?: string;
}

const rowClass = 'flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-sm text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const actionClass = 'rounded-lg p-2 text-xs text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export function mergeContextSources(sources: SessionContextSource[], drafts: ComposerContextRef[]) {
  const result = sources.map((source) => ({ ...source, drafts: [] as ComposerContextRef[] }));
  for (const draft of drafts) {
    const found = result.find((source) => source.id === draft.sourceId);
    if (found) found.drafts.push(draft);
    else result.push({ kind: 'note', id: draft.sourceId, title: draft.title, origins: [], drafts: [draft] });
  }
  return result;
}

/** Mounted with the session key by the header, so another session never inherits an open panel. */
export function SessionContextPanel({ sessionKey, draftRefs = [], project, ...props }: SessionContextPanelProps) {
  const [open, setOpen] = useState(false);
  const language = useLocaleStore((state) => state.language);
  const copy = sessionContextCopy(language);
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const { data: cachedData, error, isLoading, isValidating, mutate } = useSessionContext(sessionKey, open);
  const data = error ? undefined : cachedData;
  const currentProject = data?.work.project ?? (!sessionKey && project ? { id: project.id, title: project.name } : undefined);
  const task = data?.work.task;
  const sources = mergeContextSources(data?.sources ?? [], draftRefs);
  const environment = data?.environment;
  const summary = [currentProject?.title, task?.title, sources.length ? `${copy.sources} ${sources.length}${data?.sourcesHasMore ? '+' : ''}` : null,
    environment?.kind === 'managed_worktree' ? 'Worktree' : null].filter(Boolean).join(' · ') || copy.title;
  const close = () => setOpen(false);
  const sourceNoteAvailable = sources.some((source) => !source.unavailable && source.origins.some((origin) => origin.kind === 'session'));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={copy.title} title={summary} className={`${actionClass} inline-flex h-8 min-w-0 max-w-60 shrink items-center gap-1.5`}>
          <ListFilter className="size-4 shrink-0" aria-hidden />
          <span className="hidden truncate lg:inline">{summary}</span>
          <ChevronDown className="hidden size-3 shrink-0 sm:block" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} collisionPadding={12} aria-label={copy.title}
          className="z-50 flex h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover">
          <div className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-4 py-2">
            <h2 className="text-sm font-medium text-fg">{copy.title}</h2>
            {sessionKey ? <button type="button" className={actionClass} aria-label={copy.refresh} disabled={isValidating} onClick={() => void mutate()}>
              <RefreshCw className={`size-3.5 ${isValidating ? 'animate-spin' : ''}`} aria-hidden />
            </button> : null}
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {error || data?.unavailableSections.length ? <p role="status" className="text-xs text-fg-muted">{copy.failed}</p> : null}
            {isLoading ? <div className="space-y-4" aria-label={copy.title} aria-busy="true">{[0, 1, 2, 3].map((n) => <Skeleton key={n} className="h-8 w-full" />)}</div> : (
              <>
                <section>
                  <h3 className="mb-1 text-xs font-medium text-fg-subtle">{copy.work}</h3>
                  {currentProject ? <Link className={rowClass} to={withDetailReturnTo(`/projects/${encodeURIComponent(currentProject.id)}`, returnTo)} onClick={close}>
                    <FolderKanban className="size-4 shrink-0" aria-hidden /><span className="truncate" title={currentProject.title}>{currentProject.title}</span>
                  </Link> : null}
                  {task ? <Link className={rowClass} to={taskDetailModalHref(returnTo, task.id)} onClick={close}>
                    <Target className="size-4 shrink-0" aria-hidden /><span className="truncate" title={task.title}>{task.title}</span><span className="ml-auto shrink-0 text-xs text-fg-muted">{task.phase}</span>
                  </Link> : null}
                  {!currentProject && !task ? <p className="py-2 text-xs text-fg-muted">{error || data?.unavailableSections.includes('work') ? copy.unavailable : copy.emptyWork}</p> : null}
                  {currentProject && props.onLeaveProject ? <button type="button" className={actionClass} onClick={() => { close(); props.onLeaveProject?.(); }}>{props.leaveProjectLabel}</button> : null}
                </section>
                <section className="border-t border-edge-subtle pt-3">
                  <h3 className="mb-1 text-xs font-medium text-fg-subtle">{copy.sources} {sources.length || ''}</h3>
                  {sources.map((source) => {
                    const labels = [...source.origins.map((origin) => `${origin.kind === 'session' ? copy.session : copy.task}${origin.version ? ` · ${origin.version}` : ''}`),
                      ...source.drafts.map((draft) => `${copy.draft} · ${draft.expectedVersion}`)];
                    const body = <><FileText className="mt-0.5 size-4 shrink-0" aria-hidden /><span className="min-w-0 flex-1"><span className="block truncate">{source.unavailable ? copy.unavailable : source.title || copy.untitled}</span><span className="block break-words text-xs text-fg-subtle">{labels.join(' / ')}</span></span></>;
                    return source.unavailable ? <div key={source.id} className="flex gap-2 px-2 py-2 text-sm text-fg-muted">{body}</div>
                      : <Link key={source.id} className={`${rowClass} items-start`} to={withDetailReturnTo(`/notes/${encodeURIComponent(source.id)}`, returnTo)} onClick={close}>{body}</Link>;
                  })}
                  {!sources.length ? <p className="py-2 text-xs text-fg-muted">{error || data?.unavailableSections.includes('sources') ? copy.unavailable : copy.emptySources}</p> : null}
                  {data?.sourcesHasMore ? <p className="text-xs text-fg-muted">{copy.more}</p> : null}
                  {sourceNoteAvailable && props.onDraftSourceNote ? <button type="button" className={actionClass} onClick={() => { close(); props.onDraftSourceNote?.(); }}>{props.draftSourceNoteLabel}</button> : null}
                </section>
                <section className="border-t border-edge-subtle pt-3">
                  <h3 className="mb-1 text-xs font-medium text-fg-subtle">{copy.environment}</h3>
                  {environment ? <><p className="py-2 text-sm text-fg">{environment.kind === 'managed_worktree' ? copy.worktree : copy.local}</p>
                    <p className="break-all text-xs text-fg-muted">{environment.rootPath}</p>
                    {!environment.available ? <p className="mt-2 text-xs text-fg-muted">{copy.unavailableEnvironment}</p> : null}
                    {environment.branch || environment.headSha ? <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-fg-muted"><GitBranch className="size-4 shrink-0" aria-hidden /><span className="break-all">{environment.branch || (environment.detached ? copy.detached : '')} {environment.headSha?.slice(0, 8)}</span></div> : null}
                  </> : <p className="py-2 text-xs text-fg-muted">{sessionKey ? copy.unavailable : copy.emptyEnvironment}</p>}
                  {sessionKey && environment && props.onWorkspaceChange ? <div className="mt-2"><ChatWorkspaceControl sessionKey={sessionKey} workspacePath={environment.rootPath} available={environment.available} canChangeWorkspace={Boolean(props.canChangeWorkspace)} disabled={Boolean(props.workspaceDisabled)} onWorkspaceChange={async (path) => { await props.onWorkspaceChange?.(path); await mutate(); }} /></div> : null}
                </section>
              </>
            )}
          </div>
          <p className="shrink-0 border-t border-edge-subtle px-4 py-3 text-xs leading-5 text-fg-subtle">{copy.hint}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
