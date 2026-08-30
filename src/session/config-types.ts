import type {
  ElevatedMode,
  ReasoningLevel,
  ThinkLevel,
  VerboseLevel,
} from '../agent/transcript/thinking-types.js';
import type { ResponseLanguage } from '../i18n/response-language.js';

/**
 * Session-level agent configuration persisted in SQLite.
 * These settings override agent defaults for a specific session.
 */
export interface SessionAgentConfig {
  thinkingLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  verboseLevel?: VerboseLevel;
  elevatedMode?: ElevatedMode;
  modelOverride?: string;
  providerOverride?: string;
  workingDirectoryOverride?: string;
  responseLanguage?: ResponseLanguage;
  userContextMode?: 'enabled' | 'off' | 'temporary';
  updatedAt?: number;
}
