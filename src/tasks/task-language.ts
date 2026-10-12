import { getUserProfileSnapshot } from '../user-model/profile.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import type { TaskAggregate, TaskUiLocale } from './task-repository.js';

/** Background tasks have no current user message from which to infer a language. */
export function resolveTaskLocale(task: Pick<TaskAggregate, 'locale' | 'title'> & { contract?: { objective: string } }): TaskUiLocale {
  if (task.locale) return task.locale;
  const locale = isXopcDatabaseOpen() ? getUserProfileSnapshot().locale?.toLowerCase() : undefined;
  if (locale === 'zh' || locale?.startsWith('zh-')) return 'zh';
  if (locale === 'en' || locale?.startsWith('en-')) return 'en';
  return /[\u3400-\u9fff]/u.test(task.contract?.objective ?? task.title) ? 'zh' : 'en';
}
