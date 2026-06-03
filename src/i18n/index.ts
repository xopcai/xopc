/**
 * Server-side i18n (Node). Message files live under `src/i18n/locales/`.
 * Web UI keeps its own bundles under `web/src/i18n/` until merged.
 */

export { formatI18n } from './format.js';
export {
  DEFAULT_SERVER_LOCALE,
  normalizeServerLocale,
  SERVER_LOCALES,
  type ServerLocale,
  serverLocaleOrFallback,
  isServerLocale,
} from './locale.js';
export {
  goalsContinuationChecklistTemplate,
  goalsContinuationPlainTemplate,
  goalsEvaluateCopy,
  goalsJudgeReason,
  goalsJudgeResponseLanguageNote,
  goalsChecklistProgressSuffix,
  goalsMessages,
  JUDGE_REASON_EN,
  type GoalsMessages,
  type JudgeReasonId,
} from './goals-bundle.js';
export {
  resolveToolLocale,
  shareToolErrorLine,
  shareToolMessages,
  shareToolSuccessLines,
  type ShareToolMessages,
} from './share-tool-bundle.js';
