import type { ElectronUnderstandingSourceDefinition, ElectronUnderstandingSourceItem } from '@/types/electron';

export type ContextualSourceOffer = {
  sourceId: string;
  label: string;
  reason: string;
  actionLabel: string;
};

type MatcherRule = {
  sourceId: string;
  pattern: RegExp;
  zh: { label: string; reason: string; actionLabel: string };
  en: { label: string; reason: string; actionLabel: string };
};

const CONTEXTUAL_RULES: MatcherRule[] = [
  {
    sourceId: 'apple-calendar',
    pattern: /(?:会议|日程|排期|周报|复盘|汇报|议程|预约|meeting|calendar|schedule|standup|weekly|agenda)/i,
    zh: {
      label: 'Apple 日历',
      reason: '顺手只读近期日程，让准备和梳理更贴合你的真实安排',
      actionLabel: '读取近期日程',
    },
    en: {
      label: 'Apple Calendar',
      reason: 'Read upcoming and recent events (read-only) to tailor this to your real schedule',
      actionLabel: 'Include calendar',
    },
  },
  {
    sourceId: 'apple-mail',
    pattern: /(?:邮件|邮箱|回信|客户回复|报价邮件|email|mail|inbox|reply)/i,
    zh: {
      label: 'Apple 邮件',
      reason: '只读参考近期相关邮件线索，省去你手动复制背景',
      actionLabel: '读取近期邮件',
    },
    en: {
      label: 'Apple Mail',
      reason: 'Reference recent relevant email threads (read-only) without copying context manually',
      actionLabel: 'Include mail',
    },
  },
  {
    sourceId: 'apple-reminders',
    pattern: /(?:待办|提醒|清单|任务列表|今日优先|reminder|todo|to-do|checklist|priorit)/i,
    zh: {
      label: 'Apple 提醒事项',
      reason: '只读带入未完成提醒，帮你一起排优先级',
      actionLabel: '读取提醒事项',
    },
    en: {
      label: 'Apple Reminders',
      reason: 'Pull in your open reminders (read-only) to help prioritize accurately',
      actionLabel: 'Include reminders',
    },
  },
  {
    sourceId: 'apple-notes',
    pattern: /(?:备忘录|笔记|草稿|灵感|notes?\b|memo)/i,
    zh: {
      label: 'Apple 备忘录',
      reason: '只读参考近期备忘录内容，直接接着你的草稿推进',
      actionLabel: '读取近期备忘录',
    },
    en: {
      label: 'Apple Notes',
      reason: 'Reference recent notes (read-only) so we can build directly on your drafts',
      actionLabel: 'Include notes',
    },
  },
];

/**
 * Matches at most one just-in-time local source relevant to what the user is currently typing.
 * Never returns a source unless it is actually available on this device.
 */
export function matchContextualLocalSource(
  text: string,
  availableSources: ElectronUnderstandingSourceDefinition[],
  language: 'en' | 'zh',
): ContextualSourceOffer | null {
  const trimmed = text.trim();
  if (trimmed.length < 2 || availableSources.length === 0) return null;
  const availableIds = new Set(
    availableSources
      .filter((source) => source.availability === 'available')
      .map((source) => source.id),
  );
  for (const rule of CONTEXTUAL_RULES) {
    if (!availableIds.has(rule.sourceId)) continue;
    if (!rule.pattern.test(trimmed)) continue;
    const copy = rule[language];
    return {
      sourceId: rule.sourceId,
      label: copy.label,
      reason: copy.reason,
      actionLabel: copy.actionLabel,
    };
  }
  return null;
}

export function formatContextualSourceSnippet(
  label: string,
  items: ElectronUnderstandingSourceItem[],
  language: 'en' | 'zh',
): string {
  const usable = items.slice(0, 6);
  if (usable.length === 0) return '';
  const lines = usable.map((item) => {
    const when = item.startsAt ?? item.modifiedAt ?? item.occurredAt;
    const dateTag = when ? new Date(when).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }) : '';
    const snippet = item.text ? item.text.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    return `- ${dateTag ? `[${dateTag}] ` : ''}${item.title}${snippet ? `：${snippet}` : ''}`;
  });
  const header = language === 'zh'
    ? `【已附带的本地参考：${label}】`
    : `[Attached local context: ${label}]`;
  return `${header}\n${lines.join('\n')}`;
}
