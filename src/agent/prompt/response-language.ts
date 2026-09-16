import type { Config } from '../../config/schema.js';
import {
  resolveResponseLanguage,
  type ResponseLanguage,
} from '../../i18n/response-language.js';
import {
  getSessionConfig,
  isXopcDatabaseOpen,
} from '../../storage/sqlite/index.js';

export function resolveResponseLanguageForSession(
  config: Config | undefined,
  conversationId?: string,
): ResponseLanguage {
  const userPreference = config?.userContext?.preferences?.responseLanguage ?? 'auto';
  const sessionPreference =
    conversationId && isXopcDatabaseOpen()
      ? getSessionConfig(conversationId)?.responseLanguage
      : undefined;
  return resolveResponseLanguage(userPreference, sessionPreference);
}
