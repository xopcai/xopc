import { FolderOpen, GitBranch, Laptop, RefreshCw, Shuffle, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { useDebounce } from 'use-debounce';

import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useSessionContext } from '@/features/chat/context/use-session-context';
import { folderDisplayName } from '@/features/fs/directory-path-utils';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import { fetchProjects } from '@/features/projects/api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

export interface ComposerContextBarProps {
  sessionKey: string | null;
  project?: { id: string; name: string } | null;
  workspacePath?: string | null;
  canChangeWorkspace: boolean;
  disabled: boolean;
  environmentPicker?: ReactNode;
  onProjectChange: (projectId: string | null) => void;
  onWorkspaceChange: (path: string) => Promise<void>;
}

const controlClass = 'inline-flex h-8 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm text-fg transition-[background-color,transform] hover:bg-surface-hover active:scale-95 disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export function ComposerContextBar({ sessionKey, project, workspacePath, canChangeWorkspace, disabled, environmentPicker, onProjectChange, onWorkspaceChange }: ComposerContextBarProps) {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const copy = m.chat.composerContext;
  const token = useGatewayStore((state) => state.token);
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const [query, setQuery] = useState('');
  const [search] = useDebounce(query, 200);
  const projects = useSWR(['composer-projects', baseUrl, token, search], () => fetchProjects({ status: 'active', search, sortBy: 'updatedAt', sortOrder: 'desc', limit: 50 }), { keepPreviousData: false, shouldRetryOnError: false });
  const context = useSessionContext(sessionKey, false);
  const environment = context.error ? undefined : context.data?.environment;
  const rootPath = workspacePath?.trim() || environment?.rootPath || '';
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const picker = useDirectoryPicker({
    initialPath: rootPath,
    onPicked: async (path) => {
      setDirectoryError(null);
      try {
        await onWorkspaceChange(path);
        await context.mutate();
      } catch (error) {
        setDirectoryError(error instanceof Error ? error.message : String(error));
      }
    },
  });
  const workspaceTitle = canChangeWorkspace ? `${copy.chooseFolder}${rootPath ? `: ${rootPath}` : ''}` : project ? copy.projectFolder : copy.lockedFolder;
  const branch = environment?.branch || (environment?.detached ? environment.headSha?.slice(0, 8) : undefined);

  return (
    <>
      <div className="mx-3 -mb-3 flex min-w-0 shrink-0 flex-wrap items-center gap-x-1 gap-y-1 rounded-t-2xl bg-surface-base px-2 pb-4 pt-1.5 sm:mx-4" aria-label={copy.label}>
        <div className={cn('flex min-w-0 max-w-full items-center rounded-full', project && 'bg-surface-hover')}>
          {project ? <button type="button" disabled={disabled} title={m.chat.scopeRemoveProject} aria-label={m.chat.scopeRemoveProject}
            className={cn(controlClass, 'size-7 shrink-0 px-0 ml-0.5 text-fg-muted')}
            onClick={() => onProjectChange(null)}><X className="size-3.5" aria-hidden /></button> : null}
          <PopoverSelect
            value={project?.id ?? ''}
            selectedLabel={project?.name}
            options={(projects.error ? [] : projects.data?.items ?? []).map((item) => ({ value: item.id, label: item.name }))}
            placeholder={copy.chooseProject}
            ariaLabel={copy.changeProject}
            title={copy.changeProject}
            emptyLabel={copy.noProject}
            disabled={disabled}
            side="top"
            align="start"
            searchPlaceholder={copy.searchProjects}
            searchValue={query}
            onSearchChange={setQuery}
            loading={projects.isLoading}
            statusMessage={projects.error ? copy.projectsFailed : projects.data?.items.length === 0 ? copy.noProjects : undefined}
            triggerClassName={cn(controlClass, 'h-8 w-auto max-w-44 gap-1 border-0 bg-transparent pr-2.5 text-sm [&>svg]:hidden [&>span]:text-fg', project && 'pl-1')}
            contentClassName="xopc-composer-config-popover w-max min-w-[min(12rem,calc(100vw-1.5rem))] max-w-[min(20rem,calc(100vw-1.5rem))] [&>input]:w-0 [&>input]:min-w-full"
            onChange={(id) => { if (id !== (project?.id ?? '')) onProjectChange(id || null); }}
          />
        </div>
        {project ? environmentPicker : null}
        {!environmentPicker && project && environment && (environment.headSha || environment.branch) ? <span className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-surface-hover px-2.5 text-sm text-fg" title={environment.rootPath}>
          {environment.kind === 'managed_worktree' ? <Shuffle className="size-4 shrink-0" strokeWidth={1.75} aria-hidden /> : <Laptop className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />}
          {environment.kind === 'managed_worktree' ? 'Worktree' : 'Local'}
        </span> : null}
        {projects.error ? <button type="button" className={cn(controlClass, 'size-7 px-0')} aria-label={copy.retryProjects} onClick={() => void projects.mutate()}><RefreshCw className="size-3.5" aria-hidden /></button> : null}
        {!project ? <button type="button" className={cn(controlClass, 'max-w-52')} disabled={disabled || !canChangeWorkspace || picker.picking} title={workspaceTitle} aria-label={copy.chooseFolder} onClick={picker.pick}>
          <FolderOpen className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {rootPath ? <span className="truncate">{folderDisplayName(rootPath)}</span> : context.isLoading ? <Skeleton className="h-4 w-16" /> : <span>{copy.chooseFolder}</span>}
        </button> : null}
        {branch ? <span className="inline-flex h-8 min-w-0 max-w-44 items-center gap-1.5 px-2 text-sm text-fg" title={`${branch}${environment?.headSha ? ` · ${environment.headSha.slice(0, 8)}` : ''}`}>
          <GitBranch className="size-4 shrink-0" strokeWidth={1.75} aria-hidden /><span className="truncate">{branch}</span>
        </span> : null}
        {directoryError ? <p role="alert" className="w-full px-2 py-1 text-xs text-danger">{directoryError}</p> : null}
      </div>
      {!picker.hasNativePicker ? <WorkingDirectoryPickerModal open={picker.modalOpen} onOpenChange={picker.setModalOpen} initialAbsolutePath={rootPath || undefined} onConfirm={picker.confirmPick} wd={m.chat.workingDirectory} /> : null}
    </>
  );
}
