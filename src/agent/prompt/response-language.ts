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
  sessionKey?: string,
): ResponseLanguage {
  const userPreference = config?.userContext?.preferences?.responseLanguage ?? 'auto';
  const sessionPreference =
    sessionKey && isXopcDatabaseOpen()
      ? getSessionConfig(sessionKey)?.responseLanguage
      : undefined;
  return resolveResponseLanguage(userPreference, sessionPreference);
}
