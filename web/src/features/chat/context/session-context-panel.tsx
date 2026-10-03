import * as Popover from '@radix-ui/react-popover';
import { AppWindow, Check, Copy, Database, FileText, Folder, FolderKanban, GitBranch, ListTodo, MessagesSquare, Monitor, Paperclip, RefreshCw, Target } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import type { ComposerAttachmentSummary, ComposerContextRef } from '@/features/chat/composer/composer.types';
import { newChatHrefForProject } from '@/features/chat/session/composer-handoff-params';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { withDetailReturnTo } from '@/lib/navigation-return';
import { useLocaleStore } from '@/stores/locale-store';

import { mergeContextSources } from './merge-context-sources';
import { sessionContextCopy } from './session-context-copy';
import { useSessionContext } from './use-session-context';

export interface SessionContextPanelProps {
  conversationId: string | null;
  draftRefs?: ComposerContextRef[];
  draftAttachments?: ComposerAttachmentSummary[];
  draftPage?: ComposerAttachmentSummary | null;
  project?: { id: string; name: string; workspaceRoot?: string } | null;
  agentId?: string;
  temporary?: boolean;
  onLeaveProject?: () => void;
  leaveProjectLabel?: string;
  onDraftSourceNote?: () => void;
  draftSourceNoteLabel?: string;
}

const rowClass = 'flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-sm text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const actionClass = 'rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/** Mounted with the session key by the header, so another session never inherits an open panel. */
export function SessionContextPanel({ conversationId, draftRefs = [], draftAttachments = [], draftPage, project, ...props }: SessionContextPanelProps) {
  const [open, setOpen] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const [environmentPathCopied, setEnvironmentPathCopied] = useState(false);
  const language = useLocaleStore((state) => state.language);
  const copy = sessionContextCopy(language);
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const { data: cachedData, error, isLoading, isValidating, mutate } = useSessionContext(conversationId, open);
  const data = error ? undefined : cachedData;
  const currentProject = data?.work.project ?? (!conversationId && project ? { id: project.id, title: project.name } : undefined);
  const task = data?.work.task;
  const delegatedTasks = data?.work.delegatedTasks ?? [];
  const sources = mergeContextSources(data?.sources ?? [], draftRefs, draftAttachments, draftPage);
  const environment = data?.environment;
  const hasWork = Boolean(currentProject || task || delegatedTasks.length);
  const workUnavailable = Boolean(data?.unavailableSections.includes('work'));
  const sourcesUnavailable = Boolean(data?.unavailableSections.includes('sources'));
  const environmentUnavailable = Boolean(data?.unavailableSections.includes('environment'));
  const summary = [currentProject?.title, task?.title,
    sources.length ? `${copy.sources} ${sources.length}${data?.sourcesHasMore ? '+' : ''}` : null,
    environment?.kind === 'managed_worktree' ? 'Worktree' : null].filter(Boolean).join(' · ') || copy.title;
  const close = () => setOpen(false);
  const sourceNoteAvailable = sources.some((source) => source.kind === 'note' && !source.unavailable && source.origins.some((origin) => origin.kind === 'session'));
  const copyEnvironmentPath = () => {
    if (!environment?.rootPath) return;
    void copyTextToClipboard(environment.rootPath).then((ok) => {
      if (!ok) return;
      setEnvironmentPathCopied(true);
      window.setTimeout(() => setEnvironmentPathCopied(false), 1200);
    });
  };
  const retry = () => <button type="button" className={actionClass} aria-label={copy.refresh} disabled={isValidating} onClick={() => void mutate()}>
    <RefreshCw className={`size-3.5 ${isValidating ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
  </button>;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={copy.title} title={summary}
          className="group inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-hover hover:text-fg active:scale-95 data-[state=open]:bg-surface-hover data-[state=open]:text-fg motion-reduce:transition-none motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <ListTodo className="size-4 transition-transform duration-200 group-data-[state=open]:scale-110 motion-reduce:transform-none motion-reduce:transition-none" strokeWidth={1.75} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} collisionPadding={12} aria-label={copy.title}
          className="xopc-session-context-popover z-50 max-h-[min(30rem,var(--radix-popover-content-available-height))] w-[min(23rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-edge bg-surface-panel p-3 shadow-popover">
          <h2 className="mb-2 px-2 text-sm font-medium text-fg">{copy.title}</h2>
          {isLoading ? <div className="space-y-2 px-2" aria-busy="true">{[0, 1, 2].map((n) => <Skeleton key={n} className="h-8 w-full" />)}</div> : error ? (
            <div className="flex items-center justify-between px-2 py-2 text-sm text-fg-muted"><span>{copy.unavailable}</span>{retry()}</div>
          ) : <div className="space-y-3">
            <section aria-label={copy.work}>
              {currentProject ? <Link className={rowClass} to={withDetailReturnTo(`/projects/${encodeURIComponent(currentProject.id)}`, returnTo)} onClick={close}>
                <FolderKanban className="size-4 shrink-0" aria-hidden /><span className="min-w-0 flex-1 truncate" title={currentProject.title}>{currentProject.title}</span>
              </Link> : null}
              {task ? <Link className={rowClass} to={taskDetailModalHref(returnTo, task.id)} onClick={close}>
                <Target className="size-4 shrink-0" aria-hidden /><span className="min-w-0 flex-1 truncate" title={task.title}>{task.title}</span><span className="shrink-0 text-xs text-fg-muted">{task.phase}</span>
              </Link> : null}
              {delegatedTasks.length ? <>
                {delegatedTasks.length > 2 ? <button type="button" className={`${rowClass} w-full text-left`} onClick={() => setShowAllTasks(!showAllTasks)} aria-expanded={showAllTasks}>
                  <Target className="size-4 shrink-0" aria-hidden /><span className="flex-1">{copy.delegatedTasks} · {data?.work.delegatedTaskCount ?? delegatedTasks.length}</span><span className="text-xs text-fg-muted">{showAllTasks ? copy.collapse : copy.expand}</span>
                </button> : <p className="px-2 pt-2 text-xs text-fg-subtle">{copy.delegatedTasks} · {data?.work.delegatedTaskCount ?? delegatedTasks.length}</p>}
                {(showAllTasks ? delegatedTasks : delegatedTasks.slice(0, 2)).map((delegated) => <Link key={delegated.id} className={`${rowClass} pl-9`}
                  to={taskDetailModalHref(returnTo, delegated.id)} onClick={close}>
                  <span className="min-w-0 flex-1 truncate" title={delegated.title}>{delegated.title}</span>
                  <span className="shrink-0 text-xs text-fg-muted">{delegated.runStatus ?? delegated.phase}</span>
                </Link>)}
              </> : null}
              {!hasWork ? <p className="px-2 py-2 text-sm text-fg-muted">{workUnavailable ? copy.unavailable : copy.independent}</p> : null}
              {workUnavailable ? <div className="flex items-center justify-between px-2 text-xs text-fg-muted">{hasWork ? copy.partialUnavailable : null}{retry()}</div> : null}
              {currentProject && props.onLeaveProject ? <button type="button" className={actionClass} onClick={() => { close(); props.onLeaveProject?.(); }}>{props.leaveProjectLabel}</button> : null}
            </section>

            {sources.length || sourcesUnavailable ? <section className="border-t border-edge-subtle pt-3">
              <div className="mb-1 flex items-center justify-between px-2">
                <h3 className="text-sm text-fg-subtle">{copy.sources} {sources.length ? `${sources.length}${data?.sourcesHasMore ? '+' : ''}` : ''}</h3>
                {sourcesUnavailable ? retry() : null}
              </div>
              {(showAllSources ? sources : sources.slice(0, 3)).map((source) => {
                const relation = source.origins.some((origin) => origin.kind === 'session') ? copy.session
                  : source.origins.some((origin) => origin.kind === 'task') ? copy.task
                    : source.origins.some((origin) => origin.kind === 'recent') ? copy.recent : copy.draft;
                const label = source.pending && source.origins.length ? `${relation} · ${copy.draft}` : source.pending ? copy.draft : relation;
                const SourceIcon = source.kind === 'file' && source.fileKind === 'directory' ? Folder
                  : source.kind === 'file' ? FileText
                    : source.kind === 'session' ? MessagesSquare
                      : source.kind === 'browser_tab' || source.kind === 'browser_page' || source.kind === 'app_context' ? AppWindow
                        : source.kind === 'mcp_resource' ? Database
                          : source.kind === 'attachment' ? Paperclip : FileText;
                const title = source.unavailable ? copy.unavailable : source.title || (source.kind === 'note' ? copy.untitled : copy.untitledSource);
                const body = <><SourceIcon className="size-4 shrink-0" aria-hidden /><span className="min-w-0 flex-1 truncate" title={source.unavailable ? undefined : source.title}>{title}</span><span className="shrink-0 text-xs text-fg-muted">{label}</span></>;
                const target = source.kind === 'note' ? withDetailReturnTo(`/notes/${encodeURIComponent(source.id)}`, returnTo)
                  : source.kind === 'session' ? `/chat/${encodeURIComponent(source.id)}` : null;
                const key = `${source.kind}:${source.id}`;
                return !source.unavailable && target ? <Link key={key} className={rowClass} to={target} onClick={close}>{body}</Link>
                  : <div key={key} className="flex min-w-0 items-center gap-3 px-2 py-2 text-sm text-fg-muted">{body}</div>;
              })}
              {!sources.length ? <p className="px-2 py-2 text-xs text-fg-muted">{copy.unavailable}</p> : null}
              {sources.length > 0 && sourcesUnavailable ? <p className="px-2 py-1 text-xs text-fg-muted">{copy.partialUnavailable}</p> : null}
              {sources.length > 3 ? <button type="button" className={actionClass} onClick={() => setShowAllSources(!showAllSources)} aria-expanded={showAllSources}>{showAllSources ? copy.collapse : copy.expand}</button> : null}
              {data?.sourcesHasMore ? <p className="px-2 py-1 text-xs text-fg-muted">{copy.more}</p> : null}
              {sourceNoteAvailable && props.onDraftSourceNote ? <button type="button" className={actionClass} onClick={() => { close(); props.onDraftSourceNote?.(); }}>{props.draftSourceNoteLabel}</button> : null}
            </section> : null}

            {conversationId && (environment || environmentUnavailable) ? <section className="border-t border-edge-subtle pt-3">
              <div className="mb-1 flex items-center justify-between px-2">
                <h3 className="text-sm text-fg-subtle">{copy.environment}</h3>
                {environmentUnavailable ? retry() : null}
              </div>
              {environment ? <>
                <div className="flex min-w-0 items-center gap-3 px-2 py-2 text-sm text-fg">
                  <Monitor className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{environment.kind === 'managed_worktree' ? copy.worktree : copy.local}</span>
                  {environment.branch || environment.headSha ? <span className="inline-flex min-w-0 max-w-40 items-center gap-1 text-xs text-fg-muted"><GitBranch className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{environment.branch || (environment.detached ? `${copy.detached} · ${environment.headSha?.slice(0, 8)}` : environment.headSha?.slice(0, 8))}</span></span> : null}
                </div>
                <div className="flex min-w-0 items-center gap-2 pl-9 pr-1">
                  <span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={environment.rootPath}>{environment.rootPath}</span>
                  <button type="button" className={actionClass} aria-label={environmentPathCopied ? copy.copied : copy.copyEnvironmentPath} title={environmentPathCopied ? copy.copied : copy.copyEnvironmentPath} onClick={copyEnvironmentPath}>
                    {environmentPathCopied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  </button>
                </div>
                {!environment.available ? <p className="px-2 py-1 text-xs text-fg-muted">{copy.unavailableEnvironment}</p> : null}
                {currentProject && project?.workspaceRoot ? <Link className={actionClass} to={newChatHrefForProject(currentProject.id)} state={{ forceNewChat: true, agentId: props.agentId, temporary: props.temporary }} onClick={close}>{copy.newEnvironment}</Link> : null}
              </> : <p className="px-2 py-2 text-xs text-fg-muted">{copy.unavailable}</p>}
            </section> : null}
          </div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
