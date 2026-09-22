import type { UserAssertion } from './user-model-api';

export type UnderstandingLanguage = 'en' | 'zh';

export function formatUnderstandingDate(value: number | undefined, language: UnderstandingLanguage): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium' }).format(value);
}

export function groupUnderstandingByDate(items: UserAssertion[], language: UnderstandingLanguage, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups = new Map<string, UserAssertion[]>();
  for (const item of [...items].sort((a, b) => b.recordedAt - a.recordedAt)) {
    const label = item.recordedAt >= today.getTime()
      ? (language === 'zh' ? '今天' : 'Today')
      : item.recordedAt >= yesterday.getTime()
        ? (language === 'zh' ? '昨天' : 'Yesterday')
        : formatUnderstandingDate(item.recordedAt, language) ?? (language === 'zh' ? '更早' : 'Earlier');
    const group = groups.get(label) ?? [];
    group.push(item);
    groups.set(label, group);
  }
  return [...groups].map(([label, groupedItems]) => ({ label, items: groupedItems }));
}
