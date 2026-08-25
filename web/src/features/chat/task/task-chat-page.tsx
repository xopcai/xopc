import { useParams } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { ChatPage } from '@/features/chat/chat-page';
import { useTaskDetail } from '@/features/tasks/use-task-detail';

export function TaskChatPage() {
  const { taskId = '' } = useParams();
  const { data, error, isLoading, conversationLoading, conversationError } = useTaskDetail(taskId);
  const sessionKey = data?.conversation.activeSessionKey ?? null;

  if (isLoading || conversationLoading || (data && !sessionKey && !conversationError)) {
    return <div className="flex h-full flex-col gap-4 p-6" aria-busy><Skeleton className="h-10 w-64" /><Skeleton className="min-h-0 flex-1 rounded-xl" /></div>;
  }
  if (error || conversationError || !data) {
    return <div className="grid h-full place-items-center text-sm text-danger">Task conversation could not be loaded.</div>;
  }
  if (!sessionKey) return null;
  return <ChatPage sessionKey={sessionKey} taskId={taskId} />;
}
