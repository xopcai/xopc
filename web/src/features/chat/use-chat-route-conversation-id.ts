import { matchPath } from 'react-router-dom';
import useSWR from 'swr';

import type { TaskDetail } from '@/features/tasks/home-api';
import { taskDetailSWRKey } from '@/features/tasks/use-task-detail';
import { useGatewayStore } from '@/stores/gateway-store';

/** Observe the task page's shared detail cache without starting another task lifecycle. */
export function useChatRouteConversationId(pathname: string): string | null {
  const token = useGatewayStore((state) => state.conversationId);
  const taskRoute = matchPath('/chat/task/:taskId', pathname);
  const taskId = taskRoute ? decodeURIComponent(taskRoute.params.taskId ?? '') : '';
  const { data } = useSWR<TaskDetail>(taskDetailSWRKey(taskId, token), null, {
    keepPreviousData: false,
  });
  if (taskRoute) return data?.conversation.activeConversationId ?? null;

  const chatRoute = matchPath('/chat/:conversationId', pathname);
  const conversationId = chatRoute?.params.conversationId;
  return conversationId && conversationId !== 'new' ? decodeURIComponent(conversationId) : null;
}
