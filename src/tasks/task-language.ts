import { getUserProfileSnapshot } from '../user-model/profile.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import type { TaskAggregate, TaskUiLocale } from './task-repository.js';

/** Background tasks have no current user message from which to infer a language. */
export function resolveTaskLocale(task: Pick<TaskAggregate, 'locale' | 'title'> & { contract?: { objective: string } }): TaskUiLocale {
  if (task.locale) return task.locale;
  if (/[\u3400-\u9fff]/u.test(task.contract?.objective ?? task.title)) return 'zh';
  const locale = isXopcDatabaseOpen() ? getUserProfileSnapshot().locale?.toLowerCase() : undefined;
  if (locale === 'zh' || locale?.startsWith('zh-')) return 'zh';
  if (locale === 'en' || locale?.startsWith('en-')) return 'en';
  return 'en';
}

/** Reject untranslated English prose while allowing paths, URLs, and identifiers. */
export function hasUnlocalizedTaskText(values: readonly string[], locale: TaskUiLocale): boolean {
  if (locale !== 'zh') return false;
  return values.some(value => {
    const prose = value.replace(/`[^`]*`|https?:\/\/\S+|\S*[\/.]\S*/g, '');
    const leadingProse = prose.split(/[\u3400-\u9fff]/u, 1)[0];
    const englishSentence = /\b(?:is|are|must|should|contains?|includes?|provides?|has|have|can|will|needs?|requires?|verify|ensure|do)\b/i.test(leadingProse);
    return (!/[\u3400-\u9fff]/u.test(prose) || englishSentence)
      && (prose.match(/[a-zA-Z]+/g)?.length ?? 0) >= 4;
  });
}
