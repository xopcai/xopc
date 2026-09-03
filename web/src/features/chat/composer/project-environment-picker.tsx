import { Laptop, Loader2, RefreshCw, Shuffle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';

import type { ProjectSessionComposer } from './use-project-session-composer';

export function ProjectEnvironmentPicker({ selection }: { selection: ProjectSessionComposer }) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const { mode, options, checking, checkFailed, failure, busy, changeMode, retry } = selection;
  const reason = checkFailed ? (zh ? '无法检查运行环境，请重试。' : 'Could not check the environment. Retry.')
    : options?.worktreeUnavailableReason === 'workspace_unavailable' ? (zh ? '项目目录不可用，请在项目设置中检查路径。' : 'Project directory unavailable. Check its path in project settings.')
      : options?.worktreeUnavailableReason === 'git_commit_required' ? (zh ? 'Worktree 需要可访问且至少有一个提交的 Git 仓库。' : 'Worktree requires an accessible Git repository with at least one commit.')
        : options?.worktreeUnavailableReason === 'uncommitted_changes' ? (zh ? '仓库有未提交修改，请先提交或选择 Local。' : 'The repository has uncommitted changes. Commit them or choose Local.') : null;
  const iconClass = 'size-4 shrink-0';
  const localIcon = <Laptop className={iconClass} strokeWidth={1.75} aria-hidden />;
  const worktreeIcon = <Shuffle className={iconClass} strokeWidth={1.75} aria-hidden />;
  const group = zh ? '运行位置' : 'Work in';

  return <>
    {!options && !checkFailed ? <Skeleton className="h-8 w-36 rounded-full" /> : <PopoverSelect
      ariaLabel={zh ? '新会话运行位置' : 'New session environment'}
      placeholder={group}
      title={zh ? 'Local 指 xopc Gateway 所在机器；首次发送时创建所选环境。' : 'Local means the machine running xopc Gateway. The selected environment is created on first send.'}
      triggerIcon={busy ? <Loader2 className={iconClass + ' animate-spin motion-reduce:animate-none'} aria-hidden /> : mode === 'managed_worktree' ? worktreeIcon : localIcon}
      triggerClassName="h-8 w-auto max-w-full justify-start gap-1.5 rounded-full border-0 bg-surface-hover px-2.5 hover:bg-surface-active [&>svg:last-child]:hidden"
      contentClassName="xopc-composer-config-popover w-max min-w-0 max-w-[calc(100vw-1.5rem)]"
      side="top"
      allowEmpty={false}
      value={mode} disabled={busy || checkFailed}
      options={[
        { value: 'local_checkout', label: 'Local', icon: localIcon, group, disabled: !options?.localAvailable },
        { value: 'managed_worktree', label: 'New local worktree', icon: worktreeIcon, group, disabled: !options || Boolean(options.worktreeUnavailableReason) },
      ]}
      onChange={(value) => changeMode(value as typeof mode)}
    />}
    {reason || failure ? <Button variant="ghost" className="size-8 rounded-full p-0" disabled={busy || checking} onClick={retry} aria-label={zh ? '重新检查环境' : 'Recheck environment'}>
      <RefreshCw className={'size-3.5 ' + (checking ? 'animate-spin motion-reduce:animate-none' : '')} aria-hidden />
    </Button> : null}
    {reason ? <p role="status" className="w-full px-2 py-1 text-xs leading-5 text-fg-muted">{reason}</p> : null}
    {failure ? <p role="alert" className="max-h-20 w-full overflow-y-auto break-words px-2 py-1 text-xs leading-5 text-danger">{failure}</p> : null}
  </>;
}
