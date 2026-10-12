import type { Config } from '../../config/schema.js';
import {
  resolveResponseLanguage,
  type ResponseLanguage,
} from '../../i18n/response-language.js';
import {
  getSessionConfig,
  isXopcDatabaseOpen,
} from '../../storage/sqlite/index.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { resolveTaskLocale } from '../../tasks/task-language.js';

export function resolveResponseLanguageForSession(
  config: Config | undefined,
  conversationId?: string,
): ResponseLanguage {
  const userPreference = config?.userContext?.preferences?.responseLanguage ?? 'auto';
  const sessionPreference =
    conversationId && isXopcDatabaseOpen()
      ? getSessionConfig(conversationId)?.responseLanguage
      : undefined;
  const language = resolveResponseLanguage(userPreference, sessionPreference);
  if (language !== 'auto' || !conversationId || !isXopcDatabaseOpen()) return language;
  const taskId = new TaskConversationRepository().resolveActiveExecutionSession(conversationId)?.taskId;
  const task = taskId ? new TaskRepository().get(taskId) : undefined;
  return task ? (resolveTaskLocale(task) === 'zh' ? 'zh-CN' : 'en') : language;
}
