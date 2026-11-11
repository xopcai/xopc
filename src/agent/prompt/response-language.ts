import type { Config } from '../../config/schema.js';
import {
  resolveResponseLanguage,
  type ResponseLanguage,
} from '../../i18n/response-language.js';
import {
  getSessionConfig,
  getSessionMetadata,
  isXopcDatabaseOpen,
} from '../../storage/sqlite/index.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { resolveTaskLocale } from '../../tasks/task-language.js';
import { getUserProfileSnapshot } from '../../user-model/profile.js';

export function resolveResponseLanguageForSession(
  config: Config | undefined,
  conversationId?: string,
): ResponseLanguage {
  const userPreference = config?.userContext?.preferences?.responseLanguage ?? 'auto';
  const sessionPreference =
    conversationId && isXopcDatabaseOpen()
      ? getSessionConfig(conversationId)?.responseLanguage
      : undefined;
  if (!sessionPreference && conversationId && isXopcDatabaseOpen()
    && getSessionMetadata(conversationId)?.customData?.agentSetup === true) {
    const locale = getUserProfileSnapshot().locale?.toLowerCase().split('-')[0];
    return locale === 'zh' ? 'zh-CN' : locale === 'en' ? 'en' : userPreference;
  }
  const language = resolveResponseLanguage(userPreference, sessionPreference);
  if (language !== 'auto' || !conversationId || !isXopcDatabaseOpen()) return language;
  const taskId = new TaskConversationRepository().resolveActiveExecutionSession(conversationId)?.taskId;
  const task = taskId ? new TaskRepository().get(taskId) : undefined;
  return task ? (resolveTaskLocale(task) === 'zh' ? 'zh-CN' : 'en') : language;
}
