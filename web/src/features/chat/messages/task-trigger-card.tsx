import { Link } from 'react-router-dom';

import type { Message } from '@/features/chat/messages/messages.types';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function displayTaskTitle(title: string): string {
  const firstPhrase = title.trim().split(/[，,；;。\n]/, 1)[0]?.trim() || title.trim();
  const characters = Array.from(firstPhrase);
  return characters.length > 32 ? `${characters.slice(0, 32).join('')}…` : firstPhrase;
}

export function TaskTriggerCard({ trigger }: { trigger: NonNullable<Message['taskTrigger']> }) {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).chat.taskTrigger;
  return (
    <div className="mb-4 flex min-w-0 max-w-full items-center gap-1.5 border-t border-edge-subtle pt-5 text-sm text-fg-muted"
      data-task-trigger={trigger.entryId}>
      <span className="shrink-0">{copy.about}</span>
      <Link className="inline-flex min-w-0 max-w-[min(48vw,30rem)] font-medium text-fg hover:text-accent hover:underline"
        to={`/tasks/${encodeURIComponent(trigger.taskId)}`}
        title={trigger.taskTitle}
        aria-label={`${copy.openTask}：${trigger.taskTitle}`}>
        <span className="truncate">「{displayTaskTitle(trigger.taskTitle)}」</span>
      </Link>
      <span className="shrink-0 whitespace-nowrap">· {copy[trigger.kind]}</span>
    </div>
  );
}
