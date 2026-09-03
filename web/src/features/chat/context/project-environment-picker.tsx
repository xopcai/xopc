import type { ProjectEnvironmentOptions, SessionCreateRequest } from '@xopcai/gateway-contract';
import { Loader2, RefreshCw } from 'lucide-react';
import { useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProjectSessionPreparation } from '@/features/chat/session/use-chat-session-init';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

export function ProjectEnvironmentPicker({ preparation, onBusyChange }: {
  preparation: ProjectSessionPreparation;
  onBusyChange: (busy: boolean) => void;
}) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const token = useGatewayStore((state) => state.token);
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const [mode, setMode] = useState<NonNullable<SessionCreateRequest['executionMode']>>(preparation.project.executionMode);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const { data, error, isValidating, mutate } = useSWR(
    ['project-environment-options', baseUrl, token, preparation.project.id],
    async () => (await fetchJson<{ options: ProjectEnvironmentOptions }>(apiUrl(`/api/projects/${encodeURIComponent(preparation.project.id)}/environment-options`))).options,
    { keepPreviousData: false, revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const reason = error ? (zh ? '无法检查运行环境，请重试。' : 'Could not check the environment. Retry.')
    : data?.worktreeUnavailableReason === 'workspace_unavailable' ? (zh ? '项目目录不可用，请在项目设置中检查路径。' : 'Project directory unavailable. Check its path in project settings.')
      : data?.worktreeUnavailableReason === 'git_commit_required' ? (zh ? 'Worktree 需要可访问且至少有一个提交的 Git 仓库。' : 'Worktree requires an accessible Git repository with at least one commit.')
        : data?.worktreeUnavailableReason === 'uncommitted_changes' ? (zh ? '仓库有未提交修改。请先自行保存并提交，或选择本地目录。' : 'The repository has uncommitted changes. Save and commit them yourself, or choose Local.') : null;
  const allowed = !error && data?.localAvailable && (mode === 'local_checkout' || !data.worktreeUnavailableReason);
  const create = async () => {
    if (!allowed || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    onBusyChange(true);
    setFailure(null);
    try {
      await preparation.create(mode);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
      void mutate();
    } finally {
      submitting.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };
  return <div className="space-y-3 px-2 py-2">
    <p className="text-xs leading-5 text-fg-muted">{zh ? '在创建会话前选择运行位置。Local 指 xopc Gateway 所在机器。' : 'Choose where to work before creating the session. Local means the machine running xopc Gateway.'}</p>
    {!data && !error ? <Skeleton className="h-10 w-full" /> : <Select
      aria-label={zh ? '新会话运行位置' : 'New session environment'}
      value={mode} disabled={busy || Boolean(error)}
      onChange={(event) => { setMode(event.target.value as typeof mode); setFailure(null); }}
    >
      <SelectOption value="local_checkout" disabled={!data?.localAvailable}>{zh ? '本地目录' : 'Local directory'}</SelectOption>
      <SelectOption value="managed_worktree" disabled={!data || Boolean(data.worktreeUnavailableReason)}>{zh ? '新建本地 Worktree' : 'New local worktree'}</SelectOption>
    </Select>}
    <p className="text-xs leading-5 text-fg-muted">{mode === 'managed_worktree'
      ? (zh ? '从当前 HEAD 创建独立目录，不带入未提交修改。' : 'Create an isolated directory from current HEAD, without uncommitted changes.')
      : (zh ? '直接在项目目录工作，修改会影响该目录。' : 'Work directly in the project directory. Changes affect that directory.')}</p>
    <p className="break-all text-xs leading-5 text-fg-subtle">{preparation.project.workspaceRoot}</p>
    {reason ? <p role="status" className="text-xs leading-5 text-fg-muted">{reason}</p> : null}
    {failure ? <p role="alert" className="break-words text-xs leading-5 text-danger">{failure}</p> : null}
    <div className="flex items-center gap-2">
      <Button variant="primary" disabled={!allowed || busy || isValidating} onClick={() => void create()}>
        {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {zh ? '创建会话' : 'Create session'}
      </Button>
      <Button variant="ghost" disabled={busy || isValidating} onClick={() => void mutate()} aria-label={zh ? '重新检查环境' : 'Recheck environment'}>
        <RefreshCw className={`size-4 ${isValidating ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
      </Button>
    </div>
  </div>;
}
