import { Target } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { useSessionContext } from '@/features/chat/context/use-session-context';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { useLocaleStore } from '@/stores/locale-store';

export function VoiceDelegatedTasks({ conversationId }: { conversationId: string }) {
  const { data } = useSessionContext(conversationId, true);
  const language = useLocaleStore((state) => state.language);
  const { pathname, search } = useLocation();
  const tasks = data?.work.delegatedTasks?.slice(0, 3) ?? [];
  if (!tasks.length) return null;
  return <section className="rounded-lg border border-edge bg-surface-panel p-3" aria-label={language === 'zh' ? '后台任务' : 'Background tasks'}>
    <h3 className="mb-2 text-xs font-medium text-fg-muted">{language === 'zh' ? '后台任务' : 'Background tasks'} · {data?.work.delegatedTaskCount ?? tasks.length}</h3>
    <div className="space-y-1">
      {tasks.map((task) => <Link key={task.id} to={taskDetailModalHref(`${pathname}${search}`, task.id)}
        className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-xs text-fg hover:bg-surface-hover">
        <Target className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={task.latestUpdate?.body}>{task.title}
          {task.latestUpdate ? <span className="block truncate text-fg-subtle">{task.latestUpdate.body}</span> : null}
        </span>
        <span className="shrink-0 text-fg-subtle">{task.runStatus ?? task.phase}</span>
      </Link>)}
    </div>
  </section>;
}
