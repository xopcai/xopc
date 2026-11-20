import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';

import type { ProjectSessionComposer } from './use-project-session-composer';

export function ProjectDirectoryStatus({ composer }: { composer: ProjectSessionComposer }) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const { options, checking, checkFailed, failure, busy, retry } = composer;
  const reason = checkFailed
    ? (zh ? '无法检查项目目录。' : 'Could not check the project directory.')
    : options?.localAvailable === false
      ? (zh ? '项目目录不可用，请在项目设置中检查路径。' : 'Project directory unavailable. Check its path in project settings.')
      : null;
  if (checking && !options && !checkFailed) return <Skeleton className="h-8 w-24 rounded-full" />;
  if (!reason && !failure) return null;

  return <>
    <Button variant="ghost" className="size-8 rounded-full p-0" disabled={busy || checking} onClick={retry} aria-label={zh ? '重新检查项目目录' : 'Recheck project directory'}>
      <RefreshCw className="size-3.5" aria-hidden />
    </Button>
    {reason ? <p role="status" className="w-full px-2 py-1 text-xs leading-5 text-fg-muted">{reason}</p> : null}
    {failure ? <p role="alert" className="max-h-20 w-full overflow-y-auto break-words px-2 py-1 text-xs leading-5 text-danger">{failure}</p> : null}
  </>;
}
