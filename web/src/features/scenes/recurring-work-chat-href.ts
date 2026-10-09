import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

export function recurringWorkChatHref(language: StoredLanguage, noteId?: string, projectId?: string, intent: 'continue' | 'implement' = 'continue'): string {
  const prompts = messages(language).recurringWork.prompts;
  const request = (noteId ? prompts[intent] : prompts.start).replace('{noteId}', noteId ?? '');
  const params = new URLSearchParams({ skill: 'design-recurring-work', draft: request, autoSend: '1' });
  if (projectId?.trim()) params.set('projectId', projectId.trim());
  else params.set('projectScope', 'none');
  return `/chat/new?${params.toString()}`;
}
