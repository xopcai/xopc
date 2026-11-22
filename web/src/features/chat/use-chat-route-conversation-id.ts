import { matchPath } from 'react-router-dom';

import { useTaskDetailQuery } from '@/features/tasks/use-task-detail';

/** Observe the shared task detail without starting another task lifecycle. */
export function useChatRouteConversationId(pathname: string): string | null {
  const taskRoute = matchPath('/chat/task/:taskId', pathname);
  const taskId = taskRoute ? decodeURIComponent(taskRoute.params.taskId ?? '') : '';
  const { data } = useTaskDetailQuery(taskId, {
    keepPreviousData: false,
    revalidateOnMount: false,
  });
  if (taskRoute) return data?.conversation.activeConversationId ?? null;

  const chatRoute = matchPath('/chat/:conversationId', pathname);
  const conversationId = chatRoute?.params.conversationId;
  return conversationId && conversationId !== 'new' ? decodeURIComponent(conversationId) : null;
}
